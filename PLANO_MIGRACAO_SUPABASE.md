---
projeto: app-produtividade
versao_plano: 1.0
data: 2026-07-26
autor: Kiê + Claude
status: rascunho — aguardando decisão de execução
---

# Plano de Migração — Firebase (Firestore + Auth + Functions) → Supabase (Postgres + Auth + Edge Functions)

## 0. Sumário executivo

**Motivação:** o Claude tem um conector nativo para Supabase (SQL direto via `execute_sql`/`list_tables`), mas nenhum conector equivalente para Firestore. Migrar o backend de dados para Supabase permite fazer perguntas em linguagem natural sobre tarefas, projetos, notas e leituras diretamente no chat, sem passos intermediários (export, BigQuery, etc.).

**O que muda:** Firestore → Postgres (schema relacional com RLS), Firebase Auth → Supabase Auth (mesmo provider, Google), Cloud Functions → Supabase Edge Functions. **O que não muda:** Firebase Hosting continua servindo o SPA e o site de distribuição do APK — não há motivo estrutural pra mexer nisso (ver §8).

**Por que é uma migração grande, não uma troca de driver:** Firestore é NoSQL orientado a documentos com listeners em tempo real (`onSnapshot`) embutidos; Postgres é relacional, sem push automático por query — o Supabase Realtime cobre isso mas com um modelo diferente (eventos linha-a-linha, não snapshots completos). Isso força reescrever a camada de repositórios inteira (`src/repositories/*`), não só trocar strings de conexão.

**Escopo confirmado por levantamento de código** (branch `claude/app-database-access-p5enkq`, ver anexo de arquitetura no fim deste doc):
- 1 usuário real (app pessoal, single-tenant lógico — todo dado vive sob `users/{uid}/...`).
- 10 coleções/subcoleções de dados de usuário + 2 legadas já auto-migradas em runtime (`sections`, `completedTasks`).
- 1 arquivo de Cloud Functions (`functions/src/index.ts`, 385 linhas, 7 funções HTTPS callable, sem triggers/schedules).
- 6 arquivos de repositório (`src/repositories/*.ts`) + ~9 arquivos `src/lib/*.ts` com acesso direto ao Firestore.
- Login exclusivamente Google (web via popup, Android via `@capacitor-firebase/authentication` + bridge de idToken).

---

## 1. Arquitetura alvo

```
┌─────────────────────────────────────────────────────────────────┐
│                     DISPOSITIVO (web / Android)                  │
│   React + Vite SPA (Capacitor no Android)                        │
│   ├── @supabase/supabase-js (auth + postgrest + realtime)        │
│   ├── src/repositories/* (reescritos p/ .from()/.channel())      │
│   └── Google Sign-In (popup web / plugin nativo Android)         │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTPS + WebSocket (Realtime)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                          SUPABASE (projeto)                       │
│  ┌────────────┐  ┌────────────────┐  ┌───────────────────────┐   │
│  │  Postgres  │  │  Auth          │  │  Edge Functions        │   │
│  │  + RLS     │  │  Google OAuth  │  │  Calendar/Drive/Gemini │   │
│  │  + Realtime│  │  (mesmo client │  │  (Deno, service_role)  │   │
│  │  schema    │  │  Google Cloud) │  │                        │   │
│  │  public/   │  └────────────────┘  └───────────────────────┘   │
│  │  private   │                                                   │
│  └────────────┘                                                   │
└─────────────────────────────────────────────────────────────────┘
                            ▲
                            │ script único de migração
┌───────────────────────────┴───────────────────────────────────────┐
│  scripts/migrate-to-supabase/ (Node + firebase-admin + supabase-js)│
│  Lê users/{uid}/** no Firestore → transforma → grava no Postgres  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  FIREBASE HOSTING (permanece intocado)                            │
│  - Site principal: serve o build da SPA (dist/)                   │
│  - Site "app-produtividade-builds": distribuição do APK           │
└─────────────────────────────────────────────────────────────────┘
```

**Decisão-chave:** Hosting fica no Firebase. Não há acoplamento estrutural entre servir arquivos estáticos e onde os dados moram — os `VITE_*` do build apontam pro Supabase, o resto do pipeline de deploy (`firebase deploy --only hosting`) não muda.

---

## 2. Modelo de dados — Firestore → Postgres

### 2.1 Princípios de design

1. Uma tabela por coleção, todas com `user_id uuid references auth.users(id)` + RLS `using (auth.uid() = user_id)` — replica 1:1 o modelo atual "tudo sob o uid do dono" das `firestore.rules`.
2. IDs viram `bigint identity` (surrogate key) em vez de reaproveitar o doc-id do Firestore. O `taskId` numérico legado (usado em textos tipo `🔗 #0042`) vira uma coluna `task_number` normal, não a PK — evita a inconsistência atual de "doc id = String(taskId) OU id aleatório".
3. Campos embutidos (`Subtask[]`, `NormRect[]`, `InkStroke[]`) continuam como `jsonb` — não vale a pena normalizar em tabelas próprias pra dados que só a UI acessa como blob.
4. Referências cruzadas (`dependsOn`, `parentId`, `section`, `linkedTaskId`, `sourceItemId`) viram FKs de verdade quando apontam pra outra linha da mesma tabela ou de tabela relacionada — ganho de integridade que o Firestore não tinha.
5. Os dois documentos "privados" (refresh tokens de Calendar/Drive) vão para um **schema `private`**, não exposto pela API REST do Supabase — equivalente exato do `allow read, write: if false` atual, só acessível via `service_role` dentro de Edge Functions.
6. `app/versao` (doc público do checador de atualização do APK) **não migra** — vira um JSON estático servido pelo próprio Firebase Hosting (mais simples que manter uma tabela pública no Postgres só pra isso).
7. As coleções legadas `sections` e `completedTasks` não precisam de tabela própria: a própria app já as drena para `projects`/`tasks` em runtime (`migrateSectionsToProjects`, `migrateCompletedTasksIntoTasks`). Rodar o app uma vez contra o Firestore antes do export garante que estejam vazias; o script de export deve drenar defensivamente mesmo assim.

### 2.2 DDL completo

```sql
-- ============================================================
-- SCHEMA public — tabelas expostas via PostgREST, protegidas por RLS
-- ============================================================

create table public.projects (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  area                  text,
  categories            text[] not null default '{}',
  status                text,                    -- ProjectStatus enum (checar valores em src/types)
  priority              text check (priority in ('P1','P2','P3','')),
  moscow                text,
  objective             text,
  current_status        text,
  next_steps            text,
  deadline              timestamptz,
  estimated_duration    text,
  depends_on            bigint references public.projects(id) on delete set null,
  notes                 text,
  "order"               integer,
  status_before_block   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.tasks (
  id                          bigint generated always as identity primary key,
  user_id                     uuid not null references auth.users(id) on delete cascade,
  task_number                 integer,              -- legado Task.taskId, só p/ exibição/compat
  title                       text not null,
  note                        text,
  checked                     boolean not null default false,
  in_progress                 boolean not null default false,
  moscow                      text,
  modo                        text,
  esforco                     text,
  deadline                    timestamptz,
  added_date                  timestamptz not null default now(),
  depends_on                  integer[] not null default '{}',   -- task_number[] (mesmo user)
  subtasks                    jsonb not null default '[]',
  parent_id                   bigint references public.tasks(id) on delete set null,
  "order"                     integer,
  project_id                  bigint references public.projects(id) on delete set null,  -- = "section"
  completed_at                timestamptz,
  completed_from_section_name text,
  snoozed_until               timestamptz,
  source_item_id              bigint,               -- resolvido no pós-processo (reading_items.id)
  source_annotation_id        bigint,               -- resolvido no pós-processo (annotations.id)
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id, task_number)
);

create table public.project_ratings (          -- ex-"glicko", 1:1 com projects
  project_id  bigint primary key references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  r           double precision not null,
  rd          double precision not null,
  sigma       double precision not null,
  updated_at  timestamptz not null default now()
);

create table public.notes (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  title                 text,
  note                  text,
  items                 jsonb not null default '[]',   -- Subtask[]
  added_date            timestamptz not null default now(),
  tags                  text[] not null default '{}',
  pinned                boolean not null default false,
  project_id            bigint references public.projects(id) on delete set null,
  color                 text,
  source_item_id        bigint,
  source_annotation_id  bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.reading_items (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  drive_file_id         text,
  file_name             text,
  folder_id             text,
  folder_path           text,
  format                text check (format in ('pdf','epub')),
  title                 text,
  authors               text[] not null default '{}',
  item_type             text,
  doi                   text,
  isbn                  text,
  issn                  text,
  year                  integer,
  publication           text,
  tags                  text[] not null default '{}',
  added_date            timestamptz not null default now(),
  last_opened_at        timestamptz,
  auto_classified_at    timestamptz,
  reading_status        text,
  current_page          integer,
  project_id            bigint references public.projects(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.annotations (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  reading_item_id   bigint not null references public.reading_items(id) on delete cascade,
  page              integer not null,
  type              text check (type in ('highlight','comment','ink')),
  color             text,
  rects             jsonb,          -- NormRect[]
  text              text,
  title             text,
  comment           text,
  strokes           jsonb,          -- InkStroke[]
  anchor            jsonb,
  cfi               text,
  created_at        timestamptz not null default now(),
  linked_task_id    bigint references public.tasks(id) on delete set null,
  linked_note_id    bigint references public.notes(id) on delete set null
);

create table public.memory_docs (           -- unifica glossary/claude/projectsContext/automations/context
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  namespace   text not null check (namespace in ('glossary','claude','projects_context','automations','context')),
  slug        text,                          -- null para os docs singleton (glossary, claude)
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  unique (user_id, namespace, slug)
);

create table public.connection_status (     -- ex "calendar/status" e "drive/status"
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('calendar','drive')),
  connected     boolean not null default false,
  connected_at  timestamptz,
  primary key (user_id, provider)
);

-- índices
create index tasks_user_id_idx      on public.tasks(user_id);
create index tasks_project_id_idx   on public.tasks(project_id);
create index projects_user_id_idx   on public.projects(user_id);
create index notes_user_id_idx      on public.notes(user_id);
create index reading_items_user_id_idx on public.reading_items(user_id);
create index annotations_reading_item_idx on public.annotations(reading_item_id);
create index memory_docs_user_id_idx on public.memory_docs(user_id);

-- RLS: mesma política em todas as tabelas "public" acima
alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.project_ratings   enable row level security;
alter table public.notes             enable row level security;
alter table public.reading_items     enable row level security;
alter table public.annotations       enable row level security;
alter table public.memory_docs       enable row level security;
alter table public.connection_status enable row level security;

create policy "owner_all" on public.projects        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.tasks           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.project_ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.notes           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.reading_items   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.annotations     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.memory_docs     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- connection_status: cliente só lê, só Edge Function (service_role) escreve
create policy "owner_read" on public.connection_status for select using (auth.uid() = user_id);

-- realtime: habilitar replicação p/ as tabelas que hoje usam onSnapshot
alter publication supabase_realtime add table public.tasks, public.projects, public.notes, public.reading_items, public.annotations, public.project_ratings;

-- ============================================================
-- SCHEMA private — nunca exposto via API REST (equivalente a "allow read, write: if false")
-- ============================================================
create schema if not exists private;

create table private.oauth_tokens (
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null check (provider in ('calendar','drive')),
  refresh_token  text not null,
  scope          text,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, provider)
);
-- sem policy/grant para anon ou authenticated: só service_role (usado dentro das Edge Functions) acessa.
```

### 2.3 Notas de modelagem

- **`title` de Task** é hoje uma string "crua" que codifica campos via serialização própria (`src/lib/parser.ts`). Como todos os campos estruturados já existem em colunas separadas, `title` pode virar só o texto de exibição — vale revisar se a serialização ainda é necessária em algum lugar antes de simplificar (não fazer isso na migração de dados em si; é uma limpeza de código separada, pós-migração).
- **`dependsOn`/`parentId`/`section`**: preservados como estão hoje (arrays soltos ou FK), sem forçar tabela de junção — ganho marginal não compensa a complexidade extra pra um app de 1 usuário.
- **Glicko** continua em tabela separada de `projects`, exatamente pela razão documentada no código-fonte: "a matemática do duelo nunca contamina os campos do projeto".

---

## 3. Autenticação — Firebase Auth → Supabase Auth

- Único provider usado hoje: **Google** (nenhum email/senha, apesar do comentário desatualizado em `firestore.rules`). Migração é direta: habilitar o provider Google no dashboard do Supabase Auth.
- **Reaproveitar o mesmo OAuth Client do Google Cloud** já usado (`VITE_GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, o mesmo client usado pelas Cloud Functions de Calendar/Drive) — só é preciso adicionar a redirect URI do Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`) na lista de "Authorized redirect URIs" desse client no Google Cloud Console.
- **Web**: `supabase.auth.signInWithOAuth({ provider: 'google' })` substitui `signInWithPopup(auth, new GoogleAuthProvider())` em `src/lib/auth.ts`.
- **Android (Capacitor)**: `@capacitor-firebase/authentication` não tem equivalente Supabase nativo. Precisa trocar por um plugin de Google Sign-In nativo puro (ex.: `@codetrix-studio/capacitor-google-auth`), que devolve um Google idToken, e então chamar `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`. O SHA-1 do keystore de debug já registrado no client Android do Google Cloud (ver `android/app/build.gradle`) deve seguir funcionando — é o mesmo client OAuth, só muda quem troca o token por sessão.
- **UID muda de formato**: Firebase Auth UID (string ~28 chars) → Supabase `auth.users.id` (UUID). Como é um app de usuário único, isso não gera lógica de mapeamento em massa — só é preciso capturar o novo UUID uma vez (após o primeiro login no app migrado) para usar como `user_id` no script de importação (§5).
- Sem período de dual-auth: dado ser 1 usuário só, o cutover de auth acontece junto com o cutover de dados (§7), não precisa suportar os dois sistemas ao mesmo tempo.

---

## 4. Cloud Functions → Edge Functions

Todas as 7 funções em `functions/src/index.ts` são HTTPS callable sem triggers/schedules — mapeiam 1:1 para Edge Functions Deno:

| Cloud Function atual | Edge Function equivalente | Mudança de comportamento |
|---|---|---|
| `connectCalendar` | `connect-calendar` | Grava refresh token em `private.oauth_tokens` (provider='calendar') em vez de `users/{uid}/private/calendar`; grava status em `public.connection_status`. |
| `getCalendarAccessToken` | `get-calendar-access-token` | Lê `private.oauth_tokens`; mesma lógica de refresh e tratamento de `invalid_grant`. |
| `disconnectCalendar` | `disconnect-calendar` | Revoga no Google, apaga a linha de `private.oauth_tokens`, zera `connection_status`. |
| `connectDrive` / `getDriveAccessToken` / `disconnectDrive` | `connect-drive` / `get-drive-access-token` / `disconnect-drive` | Mesmo padrão, `provider='drive'`. |
| `callGemini` | `call-gemini` | Proxy idêntico; só precisa checar sessão via `supabase.auth.getUser()` em vez de `request.auth.uid`. |

Detalhes de implementação:
- Cada Edge Function usa o cliente Supabase com a **service_role key** (nunca exposta ao cliente) pra ler/escrever `private.oauth_tokens` — equivalente ao Admin SDK do Firebase, que ignora as `firestore.rules`.
- Autenticação do chamador: o cliente chama via `supabase.functions.invoke('connect-calendar', { body })`, que já injeta o JWT da sessão Supabase no header `Authorization`; a função extrai o `uid` com `supabase.auth.getUser(jwt)` — troca direta pelo `request.auth.uid` do `onCall`.
- Segredos (`GOOGLE_OAUTH_CLIENT_SECRET`, `GEMINI_API_KEY`) migram do Secret Manager do Firebase para `supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET=... / GEMINI_API_KEY=...`.
- Arquivos client-side a trocar: `src/lib/googleCalendar.ts`, `src/lib/googleDrive.ts`, `src/lib/geminiClient.ts` (troca de `httpsCallable(functions, 'fn')` para `supabase.functions.invoke('fn', {...})`).

---

## 5. Script de migração de dados

**Status: implementado** em `scripts/migrate-to-supabase/index.ts` (`npm run migrate:supabase -- [--dry-run]`).

**Abordagem:** como a Fase 3 corrigiu o schema pra usar `id text` (o mesmo id de documento do Firestore, não um `bigint identity` gerado pelo banco — ver §2.2), a migração não precisa remapear ids em duas passadas como um schema com PK numérica exigiria. O script lê `users/{uid}/**` direto do Firestore via `firebase-admin` (mesmo padrão de `scripts/migrate/firebase-admin.ts`) e grava no Supabase via `@supabase/supabase-js` com a `service_role` key (bypassa RLS):

1. **Login no app migrado uma vez** com a conta Google real, pra obter o novo `auth.users.id` (UUID) do Supabase. Guardar em `MIGRATE_SUPABASE_UID`.
2. **Ler do Firestore**: `tasks` (+ `completedTasks` legado, traduzindo `archivedAt`→`completed_at`), `projects` (+ `sections` legado, só para quem não tem projeto com o mesmo id — mesma lógica que `migrateSectionsToProjects.ts` tinha antes de ser removido na Fase 3), `notes`, `glicko`, `readingItems` (+ subcoleção `annotations` de cada item — não coberto pelo export/import JSON de Settings, que nunca incluiu a aba Leitura), e `memory/{glossary,claude,projectsContext,automations,context}`.
3. **Inserir em ordem de FK**: `projects` → `tasks`/`notes`/`reading_items` (todos referenciam `projects.id`) → `annotations` (referencia `reading_items.id`) → `project_ratings`/`memory_docs`. As duas únicas auto-referências (`tasks.parent_id`, `projects.depends_on`) ficam `null` na primeira passada e são preenchidas num `UPDATE` final, evitando violação de FK ao inserir um filho antes do pai no mesmo lote.
   - Conversões: Firestore `Timestamp`/`{seconds}` → `.toDate().toISOString()` (só `completed_at` precisa disso — os demais campos de data já são strings simples, ver §2.3).
4. **Validar contagens**: o script já imprime, ao final, quantas linhas leu do Firestore vs. quantas escreveu (ou escreveria, em `--dry-run`) no Supabase.
5. Rodar primeiro com `--dry-run` pra conferir as contagens antes da escrita real; revisar os dados no Supabase manualmente depois.

---

## 6. Frontend — arquivos que mudam

Repositórios (reescrever queries e trocar `onSnapshot` por `.channel(...).on('postgres_changes', ...)`):
- `src/repositories/tasksRepo.ts`, `projectsRepo.ts`, `notesRepo.ts`, `readingItemsRepo.ts`, `annotationsRepo.ts`, `glickoRepo.ts`

Bootstrap/infra:
- `src/lib/firebase.ts` → novo `src/lib/supabase.ts` (cliente `createClient`)
- `src/lib/auth.ts` (Supabase Auth + bridge nativo, ver §3)
- `src/App.tsx` (trocar `useAuthState(auth)` do `react-firebase-hooks` por hook de sessão Supabase, ex. `supabase.auth.onAuthStateChange`)

Acesso direto ao Firestore fora dos repositórios (todos precisam de reescrita pontual):
- `src/lib/taskMutations.ts`, `src/lib/migrateSectionsToProjects.ts` (deletável — legado já drenado, ver §2.1 item 7), `src/lib/importWriter.ts`, `src/lib/exportFetcher.ts`, `src/lib/atualizacao.ts`, `src/lib/useUserData.ts`

Chamadas de função:
- `src/lib/geminiClient.ts`, `src/lib/googleCalendar.ts`, `src/lib/googleDrive.ts`

**Ponto de atenção arquitetural — Realtime**: `onSnapshot` do Firestore entrega o array inteiro do resultado a cada mudança; o Realtime do Supabase entrega eventos linha-a-linha (`INSERT`/`UPDATE`/`DELETE`). Os repositórios precisam de um fetch inicial (`select().eq('user_id', uid)`) + um reducer que aplica os eventos incrementalmente ao array em memória — mais código que o padrão atual, é o ponto de maior esforço de reescrita desta migração.

Mobile:
- `capacitor.config.ts` (trocar config do plugin `FirebaseAuthentication` pelo novo plugin de Google Sign-In)
- Dependências: remover `firebase`, `@capacitor-firebase/authentication`, `react-firebase-hooks`, `firebase-admin` (root); adicionar `@supabase/supabase-js` + plugin de Google Sign-In nativo escolhido.

---

## 7. Fases de execução

- [ ] **Fase 0 — Setup**: criar projeto Supabase (produção) + 1 branch de teste; configurar Google provider no Auth; registrar redirect URI do Supabase no client OAuth do Google Cloud.
- [ ] **Fase 1 — Schema**: aplicar o DDL da §2.2 como migration do Supabase (`supabase migration new` + `supabase db push`), primeiro no branch de teste.
- [ ] **Fase 2 — Edge Functions**: implementar as 7 funções da §4, testar cada uma isoladamente com `supabase functions serve` local antes de deploy.
- [ ] **Fase 3 — Frontend (branch separada)**: reescrever repositórios + auth + lib/* listados na §6, apontando pro projeto Supabase de teste. Rodar a app localmente, testar manualmente cada view.
- [ ] **Fase 4 — Script de migração**: escrever e rodar `scripts/migrate-to-supabase/` (§5) contra o projeto de teste, usando um export real dos dados de produção (leitura, não afeta o Firestore). Validar contagens e abrir a app pra conferir visualmente.
- [ ] **Fase 5 — Capacitor/Android**: trocar plugin de Google Sign-In, testar login nativo no APK de debug.
- [ ] **Fase 6 — Cutover**: rodar a migração de dados uma última vez contra o projeto Supabase de produção (mais recente que o de teste), trocar as env vars `VITE_*`/build pra apontar pro Supabase, fazer o deploy (`firebase deploy --only hosting`, já que hosting não muda).
- [ ] **Fase 7 — Período de segurança**: manter o Firestore, as `firestore.rules` e as Cloud Functions atuais **ativos e intocados** por 2–4 semanas após o cutover, sem escrita nova (só como cópia fria de segurança). Só decomissionar (`firebase deploy` sem `firestore`/`functions`, ou desligar o projeto) depois de confirmar estabilidade.
- [ ] **Fase 8 — Validação do motivo original**: confirmar no chat que dá pra consultar as tabelas via conector Supabase (`list_tables`, perguntas em linguagem natural sobre tarefas/projetos).

**Rollback**: como a Fase 4 só *lê* do Firestore (nunca escreve), e a Fase 7 mantém tudo no Firebase intacto, reverter a qualquer momento antes do fim da Fase 7 é só voltar as env vars/build pro Firebase — nenhum dado é perdido ou sobrescrito no processo.

---

## 8. Hosting e custos

- **Firebase Hosting permanece** servindo `dist/` (SPA) e o site `app-produtividade-builds` (distribuição do APK) — nenhuma mudança aqui além de, futuramente, remover `firestore`/`functions` do comando `deploy` do `package.json` quando a Fase 7 terminar.
- **Custo**: Firebase Spark (grátis) atual → Supabase Free tier cobre folgado o uso de 1 pessoa (500 MB de banco, 5 GB de egress/mês, Auth ilimitado). Único detalhe prático: projetos Supabase gratuitos **pausam após ~1 semana de inatividade** — se isso incomodar, dá pra manter "quente" com um cron simples (ex. GitHub Actions agendado batendo num endpoint) ou aceitar o cold-start de alguns segundos ao reabrir depois de um tempo parado.

---

## Anexo — Levantamento de arquitetura atual (referência)

Resumo do estado hoje, levantado por leitura completa do código-fonte (não é plano, é o "de onde partimos"):

- **Firestore**: tudo sob `users/{uid}/...` — `tasks`, `projects`, `notes`, `readingItems` (+ subcoleção `annotations`), `glicko`, `memory` (+ subcoleções `projectsContext/docs`, `automations/docs`, `context/docs`), `private/calendar` e `private/drive` (server-only), `calendar/status` e `drive/status` (client read-only), e as legadas `sections`/`completedTasks` (auto-drenadas em runtime). Doc público `app/versao` fora do namespace de usuário.
- **`firestore.rules`**: modelo single-owner — `auth.uid() == uid` do path, sem RBAC nem compartilhamento; `private/**` bloqueado até pro dono; `app/versao` público-leitura.
- **Cloud Functions** (`functions/src/index.ts`): 7 funções `onCall`, região `us-central1` — trio Calendar (connect/getAccessToken/disconnect) + trio Drive (idêntico) + `callGemini` (proxy). Secrets: `GOOGLE_OAUTH_CLIENT_SECRET`, `GEMINI_API_KEY`; client ID do OAuth é público e compartilhado com o client-side.
- **Auth**: só Google — popup na web (`signInWithPopup`), bridge nativo no Android via `@capacitor-firebase/authentication` (`skipNativeAuth: true`) + `signInWithCredential`. `uid` é a chave de particionamento de dados em todo o app (prop-drilled a partir de `App.tsx`, via `useAuthState`).
- **Camada de dados no frontend**: repositórios em `src/repositories/*` (padrão `subscribeToX`/`upsertX`/`deleteX` sobre `onSnapshot`), mais ~9 arquivos `src/lib/*.ts` com acesso direto ao Firestore (auth, export/import JSON, migração de legado, checador de versão).
- **Migração existente** (`scripts/migrate/`): script único (markdown → Firestore, via `firebase-admin` + `MIGRATE_UID`) usado no bootstrap original do app — serve de precedente de padrão de script, não de ferramenta reaproveitável diretamente.
- **Capacitor/Android**: único ponto de acoplamento Firebase é o plugin de Google Sign-In; sem FCM/push configurado (código morto no gradle); `google-services.json` não está commitado.
- **Deploy**: `firebase.json` cobre 3 alvos num só projeto (`hosting`, `firestore`, `functions`) + um segundo site de Hosting separado (`app-produtividade-builds`) pra distribuição do APK, publicado por `scripts/publicar-firebase.mjs`.

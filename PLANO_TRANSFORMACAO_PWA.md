---
projeto: app-produtividade
versao_plano: 1.1
data: 2026-05-15
autor: Kiê + Claude
status: aprovado para Fase 2 — decisões D1-D10 fechadas
---

> **Histórico de versões**
> - **1.0** (2026-05-15) — rascunho inicial.
> - **1.1** (2026-05-15) — decisões D1-D10 consolidadas. Mudança estrutural: o dashboard local **não será aposentado** — convive indefinidamente em paralelo. Push notifications movidas para Roadmap futuro.

# Plano de Transformação — Dashboard local → PWA Firebase

## 0. Sumário executivo

O sistema atual (`dashboard.html` + `servidor.ps1` + `Minhas_Tarefas.md`) será reescrito como um **Progressive Web App** servido pelo Firebase Hosting, com **Firestore** como fonte da verdade, **Firebase Auth (Google Sign-In)** restrito ao UID do Kiê, e **service worker** para uso offline-first e instalação no celular/desktop.

A migração é **incremental, não destrutiva e adicional** — o PWA é uma extensão do sistema atual, **não uma substituição**. O setup local em PowerShell (`dashboard.html` + `servidor.ps1` + `Abrir Dashboard.bat`) continua funcionando **indefinidamente em paralelo**, sem prazo pra ser desligado. O vault Obsidian original fica preservado, e nenhum arquivo `.md` existente é deletado em fase alguma.

**Resultado esperado:**

- Mesmas tarefas, mesmos projetos, mesma memória — acessíveis do celular, do tablet e de qualquer computador, com sincronização instantânea.
- Instalável como app nativo (manifest + ícones).
- Funciona offline; sincroniza quando volta a rede.
- Hospedagem gratuita no plano Spark do Firebase.
- Repositório privado em `github.com/<usuario>/app-produtividade`.

---

## 1. Visão geral da arquitetura alvo

```
┌──────────────────────────────────────────────────────────────┐
│                      DISPOSITIVO DO KIÊ                       │
│  (celular, tablet, desktop — Chrome / Safari / Edge / Firefox)│
│                                                                │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  PWA — app-produtividade                              │   │
│   │  ├── App shell (React + Vite, cached pelo SW)         │   │
│   │  ├── Estado local (Zustand ou React Context)          │   │
│   │  ├── Firestore SDK (IndexedDB cache offline-first)    │   │
│   │  └── Auth SDK (Google Sign-In persistente)            │   │
│   └──────────────────────────────────────────────────────┘   │
│                          ▲                                    │
│                          │ HTTPS + WebSocket                  │
│                          ▼                                    │
└──────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                      FIREBASE (plano Spark)                   │
│                                                                │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│   │   Hosting    │  │   Firestore  │  │      Auth        │   │
│   │ (CDN global) │  │ (NoSQL real- │  │ Google Sign-In   │   │
│   │  HTTPS auto  │  │ time, regras │  │ + restrição UID  │   │
│   │              │  │ por UID)     │  │                  │   │
│   └──────────────┘  └──────────────┘  └──────────────────┘   │
└───────────────────────────────────────────────────────────────┘
                           ▲
                           │ (uma única vez, na migração)
┌──────────────────────────┴───────────────────────────────────┐
│  Script de import (Node + Firebase Admin SDK)                 │
│  Lê os .md atuais → parseia → batch write no Firestore        │
└───────────────────────────────────────────────────────────────┘
```

**Propriedades-chave:**

- **Single-tenant lógico:** existe apenas um usuário autorizado (UID do Kiê). Tudo fica sob `users/{uid}/...`.
- **Offline-first:** Firestore SDK persiste localmente via IndexedDB; o app shell é cacheado pelo service worker. Sem internet, o app abre e aceita writes — sincroniza quando reconecta.
- **Sem backend custom:** zero servidor próprio. Firebase fornece auth, dados, hosting e regras.
- **Coexistência permanente:** o `dashboard.html` local continua lendo e escrevendo no `Minhas_Tarefas.md` indefinidamente. O PWA opera em paralelo no Firestore. Os dois sistemas convivem; não há plano de aposentar o local.

---

## 2. Stack recomendado

| Camada | Escolha | Justificativa |
|---|---|---|
| Build / dev | **Vite 5** | Hot reload rápido, suporte nativo a TS, plugin PWA maduro, ESM-first. |
| Framework UI | **React 18 + TypeScript** | Comunidade enorme com Firebase, libs prontas (`react-firebase-hooks`), tipagem ajuda a refatorar o score engine e o parser. |
| Estado global | **Zustand** | Mais leve que Redux, API funcional, casa bem com hooks. Alternativa: Context API se a complexidade ficar baixa. |
| Firestore client | **firebase v10 modular SDK** | Tree-shakeable, suporte oficial a offline persistence. |
| Styling | **CSS modules** + variáveis CSS já existentes no `dashboard.html` | Reaproveita o design system atual (cores, tipografia, espaçamentos). Evita reescrever o visual. |
| Drag & drop | **@dnd-kit/core** | Acessível, touch-friendly (essencial no celular), funciona bem em React. |
| PWA / SW | **vite-plugin-pwa** (Workbox) | Gera manifest, registra service worker, faz precache do app shell. |
| Roteamento | **React Router 6** | Padrão de mercado. Necessário pra navegação entre views (Board, Kanban, Calendário, etc.). |
| Datas | **date-fns** | Pequeno, modular, locale pt-BR nativo. Substitui as funções manuais do `dashboard.html`. |
| Markdown render | **react-markdown** + **remark-gfm** | Pra exibir o conteúdo da memória (`memory/*.md`) e os campos de nota das tarefas. |
| Testes (M5+) | **Vitest** + **Playwright** | Vitest casa com Vite; Playwright pra smoke tests E2E. |

### Por que não Svelte / Vue?

| Opção | Pró | Contra |
|---|---|---|
| Svelte + SvelteKit | Bundle menor, sintaxe mais próxima de vanilla JS (Kiê tem familiaridade), reatividade implícita. | Ecossistema Firebase menor, menos exemplos práticos, comunidade menor que React. |
| Vue 3 + Vite | Bom equilíbrio, composição API enxuta. | Menor disponibilidade de libs PWA + Firebase + dnd integradas; menos relevante pro futuro do Kiê. |

**Trade-off honesto:** Svelte produziria um PWA menor (~30-40% de bundle) e código mais conciso. React vence pela densidade de exemplos Firebase, pela curva de aprendizado mais transferível (mercado de trabalho), e pela maturidade de `@dnd-kit` + `react-firebase-hooks`. Se o critério principal for **bundle e simplicidade**, vale o experimento Svelte em M0 (1-2h de spike).

---

## 3. Modelagem de dados em Firestore

### 3.1 Princípios

1. **Tudo sob o UID do dono:** `users/{uid}/{coleção}/...` — permite a regra "só Kiê acessa" funcionar com uma única condição.
2. **Documento por entidade, não por arquivo:** cada tarefa, projeto e seção é um documento próprio. Isso remove a colisão de write do markdown monolítico.
3. **IDs persistentes preservados:** o `taskId` numérico atual (`[#NNN]`) vira o ID do documento Firestore — mantém compatibilidade com as dependências `🔗 #0042` em qualquer texto legado.
4. **Subtarefas embutidas:** subtarefas continuam como array dentro da tarefa pai (não viram coleção própria) — o uso atual delas é simples (checkbox + texto), e separá-las geraria reads extras sem ganho.
5. **Sem desnormalização agressiva:** Spark plan dá folga; otimização vem depois se necessário.

### 3.2 Esquema das coleções

```
users/
  {uid}/                                  ← Kiê (UID do Google Auth)
    profile (doc)
      displayName: "Kiê Lehm"
      email: "<email-do-usuario>"
      timezone: "America/Sao_Paulo"
      createdAt: Timestamp
      lastSeenAt: Timestamp

    sections/                             ← Categorias do Minhas_Tarefas.md
      {sectionId}/
        name: "Corrigir pptx D"
        moscow: "Must" | "Should" | "Could" | "Wont" | null
        order: 0                          ← ordem de exibição (rearranjável)
        createdAt: Timestamp

    tasks/                                ← Tarefas individuais
      {taskId}/                           ← documento ID = número do [#NNN]
        title: "Colocar hipótese do UHPC antes do Objetivo..."
        completed: false
        completedAt: Timestamp | null
        sectionId: "abc123"
        moscow: "Must" | "Should" | "Could" | "Wont" | null
        modo: "Manual" | "Colaborar" | "Delegar" | null
        esforco: "rapido" | "medio" | "longo" | null
        deadline: "2026-05-15" | null     ← string ISO date
        addedDate: "2026-05-14"
        dependsOn: ["#0042", "#0017"]     ← array de tags de dep (preserva formato)
        notes: "texto livre opcional"
        subtasks: [
          { text: "Coluna p.value", done: false },
          { text: "Coluna co2/fck.a", done: true }
        ]
        order: 0                          ← ordem dentro da seção
        createdAt: Timestamp
        updatedAt: Timestamp

    completedTasks/                       ← Arquivo histórico (substitui Tarefas_Concluidas.md)
      {taskId}/
        ...mesmos campos da task...
        archivedAt: Timestamp
        archivedFromSection: "Corrigir pptx D"

    projects/                             ← Meus_Projetos.md
      {projectId}/
        name: "Depilação a Laser"
        area: "Pessoal & Saúde / Estética & Corpo"
        status: "Em andamento" | "A iniciar" | "Pausado" | "Concluído" | "Cancelado"
        priority: "P1" | "P2" | "P3"
        objective: "Eliminar pelos definitivamente..."
        currentStatus: "Pacotes contratados..."
        nextSteps: "Agendar as datas..."
        deadline: "2026-12-01" | null
        estimatedDuration: "3 meses" | null
        dependsOn: "outroProjectId" | null
        notes: "..."
        order: 0
        createdAt: Timestamp
        updatedAt: Timestamp

    memory/                               ← memory/*.md
      glossary (doc)
        content: "...markdown completo..."
        updatedAt: Timestamp

      claude (doc)                        ← CLAUDE.md
        content: "...markdown..."
        updatedAt: Timestamp

      projectsContext/                    ← memory/projects/*.md
        {docId}/
          title: "dissertacao"
          content: "...markdown..."
          updatedAt: Timestamp

      automations/                        ← memory/automations/*.md
        {docId}/
          title: "transcrever notas manuscritas"
          content: "...markdown..."
          updatedAt: Timestamp

    diary/                                ← diary/YYYY-MM-DD.md
      {date}/                             ← doc ID = "2026-04-29"
        content: "...markdown..."
        createdAt: Timestamp
        updatedAt: Timestamp

    lists/                                ← listas/*.md
      {listId}/
        name: "Lista de desejos"
        items: [{ text, done }] | content (markdown)
        updatedAt: Timestamp

    settings (doc)                        ← preferências do app
      currentView: "board" | "kanban" | "moscow" | "list" | "calendario" | "esforco" | "prioridade"
      scoreWeights: { ... }               ← permite ajustar a fórmula sem mexer no código
      theme: "light" | "dark" | "auto"
```

### 3.3 Mapeamento dos arquivos atuais

| Arquivo atual | Destino Firestore | Notas de migração |
|---|---|---|
| `Minhas_Tarefas.md` | `users/{uid}/tasks/` + `users/{uid}/sections/` | Parser reusa lógica do `dashboard.html`. `taskId` do `[#NNN]` vira o doc ID. |
| `Tarefas_Concluidas.md` | `users/{uid}/completedTasks/` | Parse mais simples (encoding ANSI deve ser tratado — vide riscos). |
| `Meus_Projetos.md` | `users/{uid}/projects/` | Parser dedicado pra estrutura `[Status] [Prioridade]` + emojis 🎯 📌 ➡️. |
| `CLAUDE.md` | `users/{uid}/memory/claude` | Doc único; conteúdo markdown bruto. |
| `memory/glossary.md` | `users/{uid}/memory/glossary` | Doc único. |
| `memory/projects/*.md` | `users/{uid}/memory/projectsContext/{slug}` | Um doc por arquivo, ID = slug do nome. |
| `memory/automations/*.md` | `users/{uid}/memory/automations/{slug}` | Idem. |
| `memory/context/company.md` | `users/{uid}/memory/context/company` | Idem. |
| `memory/backup/*.md` | **Não migrar.** Continuam no disco como backup histórico. | Risco zero, sem ganho de migrar. |
| `diary/*.md` | `users/{uid}/diary/{date}` | Doc por data. |
| `listas/*.md` | `users/{uid}/lists/{slug}` | Doc por lista. |
| `automations.md` | `users/{uid}/memory/automations/_index` ou ignorar | Decidir em M1 se mantém. |
| `agenda Kiê.md`, `minha_rotina.md`, `watch list.md` | `users/{uid}/memory/notes/{slug}` | Coleção genérica de notas. |
| `dashboard.html`, `servidor.ps1`, `Abrir Dashboard.bat`, `fix_regex.ps1`, `DASHBOARD_CONTEXTO.md` | **Permanecem no disco.** Não vão pro Firestore — pertencem ao sistema local que continua rodando em paralelo. | Mantêm no repo Git como referência histórica. |
| `Inter.woff2` | Bundle Vite (assets/) | Reutilizar fonte. |
| `default-clipper.json` | Não migrar | Config externa do Obsidian. |
| `skills/` | **Não migrar.** | Pertence ao ecossistema Claude Code/Cowork, não ao app. Pode ficar de fora do repo (a decidir na Fase 2). |
| `outputs/`, `.trash/`, `.obsidian/` | **Não migrar e adicionar ao `.gitignore`.** | Lixo de trabalho/IDE. |

---

## 4. Estratégia de migração de dados

### 4.1 Princípios

- **Script único, executado uma vez** (e idempotente — pode rodar de novo sem duplicar).
- **Executado localmente pelo Kiê**, com chave de serviço Admin SDK (nunca commitada).
- **Lê os `.md` atuais, parseia, escreve em batch no Firestore.**
- **Dry-run primeiro:** modo `--dry-run` que mostra o que seria escrito sem tocar no Firestore.

### 4.2 Estrutura do script

```
scripts/
  migrate/
    index.ts                              ← entry point CLI
    parsers/
      parseTasks.ts                       ← extrai tarefas + seções de Minhas_Tarefas.md
      parseCompleted.ts                   ← Tarefas_Concluidas.md
      parseProjects.ts                    ← Meus_Projetos.md
      parseMemoryDoc.ts                   ← genérico pra docs de memória
    writers/
      writeTasks.ts                       ← batch write tasks + sections
      writeProjects.ts
      writeMemory.ts
    firebase-admin.ts                     ← inicializa Admin SDK
    config.ts                             ← carrega caminhos e UID alvo
```

**Comando:**

```bash
# dry-run: só imprime o que faria
node scripts/migrate/index.ts --dry-run --uid <UID_DO_KIE>

# execução real
node scripts/migrate/index.ts --uid <UID_DO_KIE>
```

### 4.3 Pré-requisitos da migração

1. Kiê faz login uma vez no PWA já deployado → o app cria `users/{uid}/profile` e o UID dele é capturado.
2. Kiê baixa a **chave Admin SDK** (Service Account JSON) do console Firebase. Esse arquivo **NÃO entra no Git** (já no `.gitignore`).
3. Kiê roda `--dry-run` localmente; valida que o número de tarefas/seções/projetos bate com o atual.
4. Kiê roda a migração real. Cada batch tem no máx 500 ops; com ~500 tarefas o total cabe em 1-2 batches.

### 4.4 Idempotência

- Tarefas: doc ID = `taskId` numérico do `[#NNN]`. Re-rodar faz overwrite seguro (`set` com `merge: true`).
- Seções, projetos, memória: ID = slug determinístico do nome (kebab-case). Re-rodar é seguro.

### 4.5 O que NÃO migrar automaticamente

- Tarefas concluídas muito antigas (Tarefas_Concluidas.md com encoding ANSI quebrado) — converter encoding primeiro, depois decidir se migra.
- `.obsidian/`, `.trash/`, `outputs/`, fontes, imagens.

---

## 5. Manifest PWA + Service Worker

### 5.1 Manifest (`public/manifest.webmanifest`)

```json
{
  "name": "Produtividade — Kiê",
  "short_name": "Produtividade",
  "description": "PWA pessoal de tarefas, projetos e memória",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#e07b00",
  "lang": "pt-BR",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 5.2 Service Worker (`vite-plugin-pwa` + Workbox)

Estratégias de cache:

| Recurso | Estratégia | Justificativa |
|---|---|---|
| App shell (HTML, JS, CSS bundle) | `precacheAndRoute` (Workbox) | Carrega instantaneamente, mesmo offline. Atualizado quando há novo build. |
| Fontes, ícones, imagens estáticas | `CacheFirst` (12 meses) | Não mudam frequentemente. |
| Chamadas Firebase (Firestore/Auth) | **Sem cache no SW** | O SDK Firebase já tem persistência offline própria via IndexedDB. Cachear de novo no SW gera conflitos. |
| Tile do mapa, se houver | Sem mapa nesta versão. | — |

Configuração mínima no `vite.config.ts`:

```ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: { /* importado do .webmanifest */ },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    navigateFallback: '/index.html',
    runtimeCaching: [/* fontes, ícones — não Firebase */]
  }
})
```

### 5.3 Update flow

- Quando há nova versão deployada, o SW detecta e baixa em background.
- Mostra um toast: "Nova versão disponível — recarregar". O Kiê clica → `skipWaiting` → reload.

---

## 6. Auth — Google Sign-In restrito ao Kiê

### 6.1 Fluxo

1. App abre, checa `auth.currentUser`.
2. Se `null` → tela de login com botão "Entrar com Google".
3. Kiê autentica via Google; Firebase Auth retorna ID token + UID.
4. App lê `users/{uid}/profile`. Se UID ≠ UID autorizado → tela "Acesso negado, contate o dono".
5. UID autorizado → app carrega normalmente.

### 6.2 Lista de UIDs autorizados

Hardcoded no client **só** como UX (mensagem de erro mais simpática); **a verdade está nas Security Rules** (vide §7).

```ts
// src/config/access.ts
export const AUTHORIZED_UIDS = [
  'UID_DO_KIE_AQUI'  // preenchido após o primeiro login
];
```

### 6.3 Persistência

Firebase Auth persiste local por padrão (IndexedDB). Kiê faz login uma vez por dispositivo e fica logado.

---

## 7. Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Bloqueia tudo por padrão.

    // Apenas o dono pode ler/escrever sob seu próprio UID.
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid
                         && request.auth.uid == 'UID_DO_KIE_AQUI';
    }
  }
}
```

**Propriedades:**

- Sem auth → negado.
- Auth de outro usuário Google → negado (UID não bate).
- Sem `UID_DO_KIE_AQUI` no path → negado.
- Tudo testado via Firebase emulator (`firebase emulators:start`) antes do deploy.

**Importante:** o UID é hardcoded propositalmente nas regras pra que, mesmo que alguém clone o repo, suba o front, e tente logar com o próprio Google, o Firestore recuse.

---

## 8. Deploy

### 8.1 Manual (M4)

```bash
npm run build                            # gera dist/
firebase deploy --only hosting,firestore:rules
```

### 8.2 CI/CD opcional via GitHub Actions (M6)

Workflow `.github/workflows/deploy.yml`:

- Trigger: push em `main`.
- Steps: checkout → setup-node → `npm ci` → `npm run build` → `firebase-deploy-action` com service account em secret do GitHub.

**Service account vai em GitHub Secret, nunca no repo.**

---

## 9. Roadmap em milestones

### M0 — Setup (estimativa: 2-3h)

**Entregáveis:**

- Repo `app-produtividade` criado no GitHub (privado).
- Estrutura inicial Vite + React + TS.
- Firebase project criado (`app-produtividade-kie` ou similar).
- `.firebaserc` + `firebase.json` configurados.
- `.gitignore` completo.
- `README.md` inicial.
- App roda em `localhost:5173` com tela "Hello, app-produtividade".

**Critérios de aceitação:**

- `npm run dev` abre o app vazio sem erros.
- `firebase emulators:start` sobe Firestore + Auth locais.
- Push no GitHub funciona.

---

### M1 — Leitura (estimativa: 6-8h)

**Entregáveis:**

- Script `migrate/index.ts` lê `Minhas_Tarefas.md` + `Meus_Projetos.md` + `memory/*.md` e popula Firestore via Admin SDK.
- Modo `--dry-run` que imprime o diff sem escrever.
- Login Google funciona localmente.
- Tela "Lista" (view mais simples) renderiza tarefas reais lidas do Firestore.
- Filtro por seção e por MoSCoW funciona.

**Critérios de aceitação:**

- `node scripts/migrate/index.ts --dry-run` mostra todos os 500+ docs que serão criados.
- Após migração real, o Firestore tem o número exato de tarefas/seções/projetos do .md.
- Lista renderiza com badges (MoSCoW, esforço, prazo) idênticos ao dashboard atual.
- Score engine (refatorado em TS puro) bate ±1% com o do `dashboard.html` num conjunto de teste fixo.

---

### M2 — Escrita (estimativa: 8-10h)

**Entregáveis:**

- Criar / editar / completar / arquivar tarefa.
- Editar subtarefas (adicionar, marcar como done, remover).
- Editar campos: MoSCoW, esforço, modo, prazo, notas.
- Picker de dependências (paridade com o atual).
- Auto-archive de tarefas completadas para `completedTasks/` (substitui `archiveCompletedTasks()`).
- Drag & drop entre seções (move task de seção).
- CRUD de seções e de projetos.

**Critérios de aceitação:**

- Editar uma task no PWA → mudança aparece em outro dispositivo em < 2s (Firestore real-time).
- Marcar concluída → tarefa some da view ativa e aparece em `completedTasks`.
- Funciona offline: editar offline → sincroniza quando volta a rede.

---

### M3 — Views avançadas (estimativa: 10-12h)

**Entregáveis:**

- View Board (projetos × tarefas, paridade com `renderBoard()`).
- View Kanban (status × tarefas).
- View MoSCoW (4 colunas).
- View Modo Claude (Manual / Colaborar / Delegar).
- View Esforço (Rápido / Médio / Longo / Sem classificação).
- View Prioridade (lista ordenada por score).
- View Calendário (grid mensal + sidebar de prioridade).
- Drag & drop em todas as views relevantes.

**Critérios de aceitação:**

- Trocar de view < 200 ms.
- Score na view Prioridade bate com o do dashboard atual.
- Calendário: drag de sidebar pra um dia atribui prazo corretamente.

---

### M4 — PWA features + deploy (estimativa: 4-6h)

**Entregáveis:**

- Manifest + ícones (192, 512, maskable).
- Service worker via `vite-plugin-pwa`.
- App é instalável (Chrome mostra "Instalar app").
- Offline-first: abrir o app sem internet funciona e mostra os dados em cache.
- Toast "Nova versão disponível".
- Deploy real em Firebase Hosting com domínio `app-produtividade.web.app`.
- Security Rules ativas (com UID do Kiê).

**Critérios de aceitação:**

- `firebase deploy` sobe sem erro.
- Acessar do celular do Kiê → instala como app, pede login Google, mostra tarefas.
- Tentar acessar de outra conta Google → "Acesso negado".

---

### M5 — Polish (estimativa: 6-8h)

**Entregáveis:**

- Testes Vitest para o score engine + parsers.
- Smoke test E2E com Playwright (login → criar task → editar → marcar concluída).
- Performance: bundle < 500 kB gzip, FCP < 2s no 4G.
- Acessibilidade básica (foco visível, ARIA labels, contraste).
- Página `/settings` com export JSON dos dados (escape hatch contra lock-in).
- Ajustes visuais finais (tema escuro opcional).

**Critérios de aceitação:**

- Lighthouse: PWA installable ✓, performance > 80, a11y > 90.
- Export JSON gera arquivo válido com todas as tarefas/projetos/memória.
- CI no GitHub Actions roda lint + testes em cada push.

---

### M6 — CI/CD + opcional (estimativa: 2-3h)

**Entregáveis:**

- GitHub Action: deploy automático em push pra `main`.
- Service account em GitHub Secrets.
- Badge no README.

---

## 10. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Estourar plano Spark do Firebase | Baixa | Médio | Spark dá 50K reads/dia + 20K writes/dia. Uso real do Kiê: ~200-500 ops/dia. Folga >50×. Monitorar via console Firebase nos primeiros 30 dias. |
| Lock-in Firebase | Média | Baixo | Camada de repositório (`src/repositories/`) isola o Firestore. Endpoint de export JSON em M5. Migrar pra Supabase/PocketBase futuramente é refator de uma camada. |
| Perda de paridade com UI atual (especialmente calendário e drag&drop) | Média | Médio | M3 dedicado a paridade. Comparação lado-a-lado durante dev. Aceitar pequenas diferenças visuais; documentar regressões intencionais. |
| Encoding ANSI/CP1252 no `Tarefas_Concluidas.md` | Alta | Baixo | Detectar via `chardet` no parser; converter pra UTF-8 antes de processar. Pular caracteres não decodificáveis com warning. |
| Watcher self-trigger (problema atual do dashboard) | N/A | N/A | Não se aplica — Firestore real-time substitui o watcher de arquivos. |
| IDs de tarefas conflitando em rerun de migração | Baixa | Médio | Doc ID = `taskId` numérico do `[#NNN]`. Rerun é `set merge: true` — sem duplicata. |
| Divergência entre `.md` local e Firestore (não há sync bidirecional) | **Permanente** (é uma característica do design, não bug) | Médio | Os dois ambientes têm fontes de verdade independentes — vide §13. Mitigação: rodar o script de migração ad-hoc quando quiser ressincronizar (idempotente, só faz upsert). Documentar no README. Sync bidirecional automático fica como item do Roadmap futuro (§15). |
| Chave Admin SDK vazada por engano no Git | Baixa | **Crítico** | `.gitignore` inclui `*firebase-adminsdk*.json` e `serviceAccount*.json`. `git status` antes de cada commit. `gitleaks` em CI (M6). |
| UID hardcoded nas rules vira incômodo se mudar conta Google | Baixa | Baixo | Aceitável — fácil atualizar regras + deploy quando necessário. |
| Push notifications no iOS PWA | Média | Baixo | iOS suporta push em PWA instalada desde 16.4. Implementar em fase futura (não M0-M6). |
| Performance com 500+ tasks em uma única query | Baixa | Baixo | Firestore lida com isso facilmente. Adicionar `limit()` + paginação só se necessário em M5. |

---

## 11. Decisões fechadas

Todas as decisões abertas da v1.0 foram resolvidas. Resumo definitivo:

| # | Decisão | Resolução |
|---|---|---|
| D1 | Framework UI | ✅ **Vite + React + TypeScript** |
| D2 | Bundle de estado | ✅ **Zustand** |
| D3 | Domínio | ✅ **`app-produtividade.web.app`** (Firebase Hosting gratuito) |
| D4 | Push notifications | ⏭️ **Fora de M0-M6** — movido para "Roadmap futuro" (§15) |
| D5 | Migrar `skills/` pro Firestore? | ✅ **Não** — fica no `.gitignore` |
| D6 | Migrar `memory/backup/` (snapshots antigos)? | ✅ **Não** — backup histórico fica no disco |
| D7 | Commitar `memory/` no repo? | ✅ **Não** — `.gitignore`. O script de migração lê do disco local; o app em si não depende desses arquivos |
| D8 | Commitar `diary/` no repo? | ✅ **Não** — `.gitignore` (conteúdo íntimo) |
| D9 | Aposentar o dashboard local? | ✅ **Nunca aposentar.** Convive em paralelo indefinidamente |
| D10 | Tema escuro | ✅ **M5** (polish) |

---

## 12. Checklist pré-publicação no GitHub

- [ ] `.gitignore` cobre: `node_modules/`, `dist/`, `build/`, `.firebase/`, `.env`, `.env.local`, `.env.*.local`, `*firebase-adminsdk*.json`, `serviceAccount*.json`, `.DS_Store`, `Thumbs.db`, `.obsidian/`, `.trash/`, `outputs/`.
- [ ] Nenhum arquivo `.env` no `git status`.
- [ ] Nenhuma chave Firebase Admin no repo (varredura com `grep -r "private_key" .`).
- [ ] Nenhuma senha, token de API ou hash de credencial em qualquer `.md`.
- [ ] `firebase.json` aponta pra `dist/` como public.
- [ ] `firestore.rules` tem o bloco "default deny" + restrição por UID.
- [ ] `README.md` explica: o que é, estado atual (transição), como rodar o local atual, como rodar o PWA em dev.
- [ ] Sem dados pessoais sensíveis no commit inicial (CPF, RG, senhas, endereços) — varredura humana antes do push.
- [ ] Backup completo da pasta `06_PRODUTIVIDADE` feito antes de qualquer `git add`.
- [ ] Visibilidade do repo confirmada como **Private** antes do primeiro push.

---

## 13. O que existe em paralelo (estado permanente)

O sistema final, depois de tudo pronto, tem **dois ambientes coexistindo indefinidamente**:

**Ambiente local (mantido como está):**
- ✅ **Dashboard local** (`dashboard.html`, `servidor.ps1`, `Abrir Dashboard.bat`) — continua funcionando exatamente como hoje.
- ✅ **Arquivos `.md`** (`Minhas_Tarefas.md`, `Meus_Projetos.md`, etc.) — fonte da verdade do ambiente local.
- ✅ **Vault Obsidian** original — intocado.
- ✅ **Skills, OpenLCA, N8N, Power BI** — não são afetados.

**Ambiente PWA (novo, adicional):**
- 🆕 **App em `app-produtividade.web.app`** — instalável no celular/desktop, com Firestore como fonte da verdade.
- 🆕 **Repo `app-produtividade`** no GitHub privado — código + histórico Git.

**Convivência:**
- Os dois ambientes têm **fontes de verdade independentes** (arquivo `.md` local vs Firestore na nuvem). Não há sync bidirecional automático.
- A **migração inicial** (script único de import) é o único ponto de transferência de dados entre os dois.
- O Kiê escolhe qual ambiente usar caso a caso: dashboard local quando estiver no desktop em Taubaté/Campinas, PWA quando estiver no celular ou em qualquer outro lugar.
- Mudanças posteriores no `.md` local **não** aparecem no PWA, e vice-versa. Mitigação: rodar a migração novamente ad-hoc se quiser ressincronizar (idempotente — só faz upsert).

Essa convivência é uma decisão consciente: simplicidade > sync bidirecional. Vide §10 (riscos) para o trade-off.

---

## 14. Próximos passos imediatos

Decisões D1-D10 fechadas (vide §11). Fase 2 em execução:

1. ✅ Plano v1.1 atualizado com decisões consolidadas.
2. ⏳ Varredura de segurança da pasta (tokens, .env, credenciais).
3. ⏳ Criação de `.gitignore` cobrindo Node + Firebase + ignores específicos (`memory/`, `diary/`, `skills/`, `outputs/`, `.obsidian/`, `.trash/`).
4. ⏳ Criação de `README.md` na raiz.
5. ⏳ `git init` + branch `main`.
6. ⏸️ **Pausa antes do commit:** mostrar ao Kiê o resultado da varredura + lista de arquivos do `git status`.
7. Após aprovação: commit inicial e Fase 3 (criação do repo via Chrome MCP + push).

---

## 15. Roadmap futuro (pós-M6)

Funcionalidades fora do escopo M0-M6, em ordem de provável relevância:

1. **Push notifications de prazos.** Lembretes via Web Push API (suportado em Chrome desktop, Android Chrome, e iOS 16.4+ em PWA instalada). Backend: Firebase Cloud Messaging (FCM). Estimativa: 4-6h.
2. **Sync bidirecional `.md` ↔ Firestore.** Atualmente os dois ambientes são independentes. Um daemon Node local poderia watch o `Minhas_Tarefas.md` e propagar mudanças pro Firestore, e vice-versa via webhook. Complexidade alta, valor incerto — só implementar se o Kiê pedir.
3. **Compartilhamento read-only de listas/projetos.** Gerar link público read-only de uma seção específica (ex: lista de desejos compartilhável).
4. **Integração com Google Calendar.** Tarefas com prazo viram eventos no Calendar e vice-versa.
5. **Modo "Focus" / Pomodoro.** Timer integrado, picking automático da task de maior score.
6. **Insights/analytics.** Dashboard com tendências: quantas tarefas/dia completas, distribuição MoSCoW ao longo do tempo, projetos parados há > 30 dias, etc.
7. **Voice input.** Ditar nova tarefa via Web Speech API.
8. **Tema custom (além do escuro).** Permitir trocar paleta accent (laranja atual → outras).
9. **Backup automático.** Cloud Function diária que serializa o Firestore inteiro num JSON no Cloud Storage.
10. **App nativo via Capacitor** (caso o PWA deixe a desejar no iOS). Wrapper do mesmo bundle React.

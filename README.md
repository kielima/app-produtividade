# app-produtividade

Sistema pessoal de produtividade do Kiê — **em transição** de um dashboard local single-file para um **Progressive Web App (PWA)** hospedado no Firebase.

> ⚠️ **Status:** transição em andamento. Os dois sistemas (dashboard local + PWA) convivem em paralelo de forma permanente. O PWA é uma adição, **não uma substituição** do dashboard local.

---

## O que é

Um sistema único pra gerenciar tarefas, projetos, memória de contexto e diário, com:

- **Sistema de tarefas** com IDs persistentes, dependências entre tarefas, MoSCoW (Must/Should/Could/Won't), modo de execução (Manual/Colaborar/Delegar), esforço (Rápido/Médio/Longo), prazo e idade — tudo combinado num **score engine** que ordena as tarefas por prioridade automática.
- **8 views** diferentes: Projetos (board), Kanban, MoSCoW, Modo Claude, Esforço, Prioridade (lista), Lista (ordem de inserção), Calendário.
- **Portfólio de projetos** com status (A iniciar / Em andamento / Pausado / Concluído / Cancelado) e prioridade (P1/P2/P3).
- **Memória de contexto** (glossário, perfis de projetos, automações) que ajuda IAs assistentes a decodificar o jargão pessoal.

---

## Arquitetura (dois ambientes em paralelo)

### 🖥️ Ambiente local (em uso hoje)

`dashboard.html` + `servidor.ps1` + arquivos `.md` no disco. Roda só no desktop do Kiê em `localhost:8080`.

**Como rodar:**

```powershell
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File 'C:\Users\ttibu\Documents\06_PRODUTIVIDADE\servidor.ps1'"
```

Depois abrir: `http://localhost:8080/dashboard.html`

Ou simplesmente dar dois cliques em `Abrir Dashboard.bat`.

> Os arquivos do ambiente local (`dashboard.html`, `servidor.ps1`, `Minhas_Tarefas.md`, `Meus_Projetos.md`, `memory/`, `diary/`, etc.) **não estão versionados neste repo** — eles continuam vivendo na pasta local do Kiê (`C:\Users\ttibu\Documents\06_PRODUTIVIDADE\`) e seguem operando como antes. Vide `.gitignore`.

### 📱 Ambiente PWA (em construção)

- **Stack:** Vite + React + TypeScript + Zustand
- **Backend:** Firebase (Firestore + Auth + Hosting), plano Spark gratuito
- **Deploy:** `https://app-produtividade.web.app`
- **Acesso:** restrito ao UID Google do Kiê via Firestore Security Rules

**Como rodar em dev:**

```bash
npm install
cp .env.example .env.local   # preencher VITE_FIREBASE_*
npm run dev                  # localhost:5173
```

**Comandos úteis:**

| Comando | O que faz |
|---|---|
| `npm run dev` | dev server Vite em `localhost:5173` (SW desligado em dev) |
| `npm run build` | gera bundle de produção em `dist/` + SW + manifest |
| `npm run preview` | serve `dist/` localmente pra testar o build (SW ativo) |
| `npm test` | roda testes Vitest (parser, score, calendário) |
| `npm run typecheck` | TypeScript em `--noEmit` |
| `npm run migrate -- --uid <UID> --dry-run` | importa `.md` locais → Firestore (vide `scripts/migrate/`) |
| `npm run pwa:assets` | regenera ícones PNG a partir de `public/logo.svg` |
| `npm run deploy` | build + `firebase deploy` (hosting + rules) |

### Como fazer o primeiro deploy

Pré-requisitos: conta Google + `firebase-tools` global (`npm i -g firebase-tools`).

1. **Criar projeto no console Firebase**
   - Console > Add project > Nome: `app-produtividade-kie` (ou similar; ajustar `.firebaserc` se diferente)
   - Ativar **Authentication > Google provider**
   - Ativar **Firestore Database** (modo produção; nearest region)
   - Ativar **Hosting**
2. **Login local**
   ```bash
   firebase login
   firebase use app-produtividade-kie
   ```
3. **Configurar `.env.local` (client SDK)**
   - Console > Project settings > General > Your apps > Web app > SDK setup
   - Copiar os 6 valores pra `.env.local` (vide `.env.example`)
4. **Primeiro login + capturar UID**
   ```bash
   npm run dev
   ```
   - Abrir `localhost:5173`, clicar "Entrar com Google" — qualquer conta passa (`AUTHORIZED_UIDS` vazia destrava dev)
   - Console Firebase > Authentication > Users → copiar o UID que apareceu
5. **Travar acesso ao seu UID**
   - Substituir `AUTHORIZED_UID_PLACEHOLDER` em `firestore.rules` pelo UID real
   - Opcionalmente, adicionar o UID em `src/lib/access.ts > AUTHORIZED_UIDS` (só pra UX da tela "Acesso negado"; a Rule é a verdade)
6. **Migrar dados (Admin SDK)**
   - Console > Project settings > Service accounts > Generate new private key
   - Salvar o JSON localmente (NÃO commitar; já está no `.gitignore`)
   - Setar env vars:
     ```bash
     export GOOGLE_APPLICATION_CREDENTIALS=/caminho/local/serviceAccount.json
     export MIGRATE_UID=seu-uid-aqui
     ```
   - Dry-run:
     ```bash
     npm run migrate -- --tasks /caminho/Minhas_Tarefas.md --projects /caminho/Meus_Projetos.md --memory /caminho/memory --dry-run
     ```
   - Se a contagem bater, rodar sem `--dry-run`
7. **Deploy final**
   ```bash
   npm run deploy
   ```
   App vai para `https://app-produtividade-kie.web.app` (ou domínio escolhido).
8. **Instalar como PWA no celular**
   - Abrir a URL no Chrome/Safari
   - "Adicionar à tela inicial" / "Instalar app"

---

## Por onde começar

1. 📋 [`PLANO_TRANSFORMACAO_PWA.md`](./PLANO_TRANSFORMACAO_PWA.md) — plano completo da transição: arquitetura alvo, stack, modelagem Firestore, milestones M0–M6, riscos, decisões.
2. 📖 [`DASHBOARD_CONTEXTO.md`](./DASHBOARD_CONTEXTO.md) — referência técnica do sistema local atual (parser, score engine, views, armadilhas conhecidas). **Documento de leitura obrigatória** antes de qualquer mudança no dashboard.

---

## Estrutura do repo (futuro, pós-M0)

```
app-produtividade/
├── README.md                       ← este arquivo
├── PLANO_TRANSFORMACAO_PWA.md      ← plano da transição
├── DASHBOARD_CONTEXTO.md           ← referência do sistema local
├── .gitignore
│
├── src/                            ← código fonte do PWA (M0+)
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   ├── views/                      ← 8 views (Board, Kanban, MoSCoW, ...)
│   ├── stores/                     ← Zustand stores
│   ├── repositories/               ← camada de acesso ao Firestore
│   ├── lib/
│   │   ├── score.ts                ← score engine (refatorado em TS)
│   │   └── parser.ts               ← parser dos .md (usado na migração)
│   └── types/
│
├── scripts/
│   └── migrate/                    ← script único de import .md → Firestore
│
├── public/
│   ├── manifest.webmanifest
│   └── icons/
│
├── firebase.json
├── firestore.rules
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## Sistema local (referência)

Os arquivos `dashboard.html`, `servidor.ps1`, `Abrir Dashboard.bat`, `fix_regex.ps1` e `Inter.woff2` continuam funcionando exatamente como antes. Eles estão neste repo apenas pra referência histórica e pra facilitar a portabilidade da lógica do score engine pro PWA.

Os arquivos `.md` de dados (`Minhas_Tarefas.md`, `Meus_Projetos.md`, `memory/`, `diary/`) **não** estão versionados — pertencem ao vault Obsidian pessoal do Kiê.

---

## Convivência dos dois ambientes

| Aspecto | Ambiente local | Ambiente PWA |
|---|---|---|
| **Onde roda** | Desktop do Kiê, localhost:8080 | Em qualquer dispositivo, via web ou app instalado |
| **Fonte de dados** | `Minhas_Tarefas.md` em disco | Firestore na nuvem |
| **Acesso offline** | Sim (é offline-only) | Sim (Firestore offline persistence + service worker) |
| **Sync entre dispositivos** | Não (single-device) | Sim (real-time via Firestore) |
| **Editar em mobilidade** | Não | Sim (instalável como PWA) |

Não há sync bidirecional automático. Os dois ambientes são fontes de verdade independentes. A migração inicial (script `scripts/migrate/index.ts`) é o único ponto de transferência — pode ser re-executada ad-hoc se quiser ressincronizar (idempotente).

---

## Licença

Projeto pessoal e privado. Sem licença pública.

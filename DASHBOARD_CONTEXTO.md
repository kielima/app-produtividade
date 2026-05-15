# Dashboard de Produtividade — Contexto de Desenvolvimento

Referência técnica para futuras sessões de desenvolvimento do `dashboard.html`.

---

## Arquitetura Geral

- **Arquivo principal:** `dashboard.html` — aplicação single-file (HTML + CSS + JS inline)
- **Servidor local:** `servidor.ps1` — servidor HTTP em PowerShell (System.Net.HttpListener), porta 8080
- **Dados:** `Minhas_Tarefas.md` — fonte única de verdade; o dashboard lê e escreve via HTTP
- **Arquivo de concluídas:** `tarefas_concluidas.md` — tarefas arquivadas automaticamente na abertura

### Como iniciar
```powershell
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File 'C:\Users\ttibu\Documents\06_PRODUTIVIDADE\servidor.ps1'"
```
Depois abrir: `http://localhost:8080/dashboard.html`

---

## Estrutura do `Minhas_Tarefas.md`

```markdown
## Nome da Seção [Prioridade MoSCoW]

- [ ] **Título da Tarefa [#0042] [Modo] [Prioridade] 🔗 #0017 🔗 #0031** - nota opcional
  - [ ] subtarefa 1
  - [x] subtarefa 2
```

- `[Must]` / `[Should]` / `[Could]` — prioridade MoSCoW (no cabeçalho da seção OU na tarefa)
- `[Manual]` / `[Colaborar]` / `[Delegar]` — modo de execução
- `[Rápido]` / `[Médio]` / `[Longo]` — esforço estimado
- `[#NNN]` — ID persistente da tarefa (ex: `[#0042]`), atribuído automaticamente por `assignAndMigrateIds()` e preservado entre reloads
- `(adicionado: YYYY-MM-DD)` — data de criação da tarefa, injetada automaticamente por `assignAndMigrateIds()` na primeira abertura após criação
- `🔗 #NNN` — dependência por ID persistente (ex: `🔗 #0017`); formato gerado pelo picker. Formato legado `🔗 PrimeirasQuatroPalavras` ainda é lido e migrado automaticamente

---

## Sistema de Dependências

### IDs Persistentes (`task.taskId`)
Cada tarefa recebe uma tag `[#NNN]` no título (ex: `[#0042]`), atribuída automaticamente pelo `assignAndMigrateIds()` na abertura.
- `task.taskId` = número inteiro persistente (extraído do `[#NNN]` no markdown)
- `taskIdMap[taskId] = task` — lookup global por ID persistente
- `getDisplayTitle()` remove da exibição: `🔗 ...`, `[#NNN]`, tags MoSCoW (`[Must]`/`[Should]`/etc.), tags de modo (`[Delegar]`/etc.), tags de esforço (`[Rápido]`/etc.), prazo (`[prazo:...]`) e data de criação (`(adicionado:...)`) — todos continuam gravados no markdown e mostrados como badges coloridos nos cards
- **Deps legados** (`🔗 primeiras4palavras`) são migrados automaticamente para `🔗 #NNN` na abertura

### Serialização
Dependências ficam embutidas no título da tarefa como `🔗 #NNN`:
```
**Mudar nome no Itaú [#0055] [Manual] [Should] 🔗 #0042**
```
Formato legado (ainda suportado para leitura): `🔗 Primeiras Quatro Palavras`

### Parsing (`parseTaskMarkdown`)
- `task.taskId` = inteiro extraído de `[#NNN]` no título (null se ausente)
- `task.dependsOn[]` = array com cada chave após `🔗` (ex: `['#0042']`)
- `task.title` preserva `[#NNN]` e `🔗 ...` para serialização fiel

### Inicialização (`assignAndMigrateIds`)
Chamada após cada carga (5 pontos). Faz 3 passos:
1. Atribui `[#NNN]` sequencial a tarefas sem ID
2. Migra deps legados (`🔗 palavras` → `🔗 #NNN`) via resolução de `buildDependencyMap`
3. Chama `markChanged()` se houve alterações → auto-save

### Resolução (`buildDependencyMap`)
- Reconstrói `depMap`, `taskFlatMap` e `taskIdMap` a cada `renderTasks()`
- **Algoritmo de match (2 etapas):**
  1. Novo: se dep começa com `#NNN` → matching exato por `taskIdMap[N]` (confiável)
  2. Legado: word-boundary (`depWordMatch`) com fallback substring `includes()`
- Resultado: `depMap[internalId] = { blockedByIds: [], unlocksIds: [] }`

### Chips nas cards
- `🔒 N` (vermelho) — tarefa bloqueada por N tarefas ainda não concluídas
- `🔑 N` (verde) — tarefa que desbloqueia N outras
- Cards bloqueadas recebem classe `dep-blocked` (texto acinzentado)

---

## Picker de Dependências (Modal)

**Abertura:** botão `🔗` em cada card → `showDepPicker(taskId)`

**Estrutura do modal** (HTML estático, criado uma vez em `showDepPicker`):
- `#depPickerCurDeps` — lista das dependências atuais (com botão ✕ para remover)
- `#depPickerSearch` — input com `addEventListener('input', ...)` — **NÃO usa oninput inline** para evitar perda de foco ao re-renderizar
- `#depPickerList` — lista filtrável de todas as tarefas

**Funções:**
- `showDepPicker(taskId)` — constrói o shell estático uma vez, anexa listener real, chama updates
- `_depPickerUpdateCurDeps()` — atualiza só o bloco de deps atuais
- `_depPickerUpdateList(filter)` — atualiza só a lista filtrada
- `renderDepPicker()` — chamado após add/remove; preserva o filtro atual do input

**`addDependency(fromId, toId)`** — adiciona `🔗 #NNN` (usando o `taskId` persistente da tarefa destino) ao final do título da tarefa de origem; verifica duplicatas via `depMap` antes de inserir

**`removeDependency(fromId, toId)`** — percorre os segmentos após `🔗` no título; resolve cada um por ID (`#NNN` → `taskIdMap`) ou por match legado de palavras; remove o segmento cujo `resolved.id` bate com `toId` (comparação via `String()` para evitar falha de tipo num/string)

---

## Arquivo Automático de Concluídas

- Roda em `tryHttpLoad()` na abertura do dashboard (função `archiveCompletedTasks()`)
- Tarefas com `[x]` são movidas para `tarefas_concluidas.md` agrupadas por seção e data
- Após arquivar, salva `Minhas_Tarefas.md` sem as tarefas concluídas

---

## Sistema de Views

| Botão | ID da View | Função de render | Container HTML | Ordenação |
|-------|-----------|-----------------|----------------|-----------|
| Projetos | `board` | `renderBoard()` | `#board` (flex) | Por score dentro de cada coluna |
| Kanban | `kanban` | `renderKanban()` | `#board` (flex) | Por score dentro de cada coluna |
| MoSCoW | `moscow` | `renderMoscow()` | `#board` (flex) | Ordem de inserção |
| Claude | `modo` | `renderModo()` | `#board` (flex) | Por score dentro de cada coluna |
| Esforço | `esforco` | `renderEsforco()` | `#board` (flex) | Por score dentro de cada coluna |
| Prioridade | `prioridade` | `renderPrioridade()` | `#listView` (block) | Por score (lista global) |
| Lista | `list` | `renderList()` | `#listView` (block) | Ordem de inserção |
| Calendário | `calendario` | `renderCalendario()` | `#calendarView` (flex) | Por score na sidebar |

> **Notas:**
> - A aba "Deps" (`renderDependencias()`) foi removida da UI. A função ainda existe no código mas não é chamada por nenhum botão.
> - Nas views com ordenação por score, cada `allTasks` enriquece as cópias com `_section` (referência ao objeto seção) para que `calcScore(task, task._section)` funcione correctamente. O helper local `sortByScore(arr)` ordena in-place por score decrescente.

`renderTasks()` sempre chama `buildDependencyMap()` antes de renderizar.

### Adição de uma nova view — checklist
1. Adicionar `<button id="xyzViewBtn">Xyz</button>` no `#taskViewToggle`
2. Adicionar container HTML no `#tasksPanel` (se necessário)
3. Declarar `const xyzViewBtn = document.getElementById('xyzViewBtn')` junto aos outros
4. Em `switchTaskView`: ocultar os três containers (`listView`, `board`, `calendarView`), mostrar o correto e adicionar `.active` ao botão
5. Em `renderTasks()`: adicionar `else if (currentView === 'xyz') { renderXyz(); }`
6. Adicionar `xyzViewBtn.addEventListener('click', () => switchTaskView('xyz'))`
7. Implementar `renderXyz()`

---

## Sistema de Prioridade (Score Engine)

### Fórmula
```
Score = (catMoSCoW × taskMoSCoW + log2(unlocks+1) + prazo_pts + log2(dias+1)×2) / esforço
```

- **catMoSCoW / taskMoSCoW**: Must=3, Should=2, Could=1, Won't=0, sem tag=1
- **Bloqueada** (tem blockers ativos não concluídos) → score = 0
- **Won't** → score = 0
- **Dependências (unlocks)**: `log2(N + 1)` — crescimento suave
- **Prazo** (`[prazo: YYYY-MM-DD]` no título da tarefa):
  - Sem prazo: 0 pts
  - Futuro (>7 dias): 1 pt
  - Essa semana: 2 pts
  - Amanhã: 3 pts
  - Hoje: 4 pts
  - Atrasada: 5 + N dias de atraso
- **Idade** (`(adicionado: YYYY-MM-DD)` — já presente em quase todas as tarefas):
  - `log2(dias_desde_criação + 1) × 2.0`
  - 1 semana → +6 pts | 1 mês → +10 pts | 3 meses → +13 pts | 1 ano → +17 pts
- **Esforço** (divisor): Rápido÷1, Médio÷2, Longo÷3

### Campos novos nas tarefas
- `task.esforco`: `'rapido'` | `'medio'` | `'longo'` | `''` — extraído de `[Rápido]`/`[Médio]`/`[Longo]` no título
- `task.deadline`: string `'YYYY-MM-DD'` — extraído de `[prazo: YYYY-MM-DD]` no título
- `task.addedDate`: string `'YYYY-MM-DD'` — extraído de `(adicionado: YYYY-MM-DD)` no título
- `section.moscow`: MoSCoW da categoria — extraído de `[Must]`/`[Should]`/etc. no nome da seção

### Funções
- `calcDeadlinePoints(deadlineStr)` — retorna pontos de prazo
- `calcScore(task, section)` — calcula o score final
- `setTaskEsforco(taskId, esforco)` — muda tag de esforço no título (drag-and-drop ou futuro picker)
- `renderEsforco()` — view em colunas: Rápido / Médio / Longo / Sem classificação
- `renderPrioridade()` — lista ordenada por score, com rank e badges de contexto

---

## View 📅 Calendário

### Visão geral
Layout em duas colunas que ocupa toda a janela:
- **Esquerda (`.cal-main`):** grade mensal + painel do dia selecionado
- **Direita (`.cal-sidebar`):** tarefas sem prazo, organizadas por score de prioridade

### Estado JS
```js
let calendarCurrentDate = new Date();   // mês exibido
let calendarSelectedDate = null;        // 'YYYY-MM-DD' ou null
```
Ambas as variáveis são **globais no script** — persistem entre re-renders.

### Estrutura do DOM gerada por `renderCalendario()`
```
#calendarView (display: flex)
└── .cal-layout (flex, gap 16px, height 100%)
    ├── .cal-main (flex-direction: column, overflow: hidden)
    │   ├── .cal-nav          ← botões ← / Hoje / →
    │   ├── .cal-grid         ← grid CSS: 7 colunas, N linhas (auto + 1fr × semanas)
    │   │   ├── .cal-weekday  ← cabeçalho Dom…Sáb
    │   │   ├── .cal-day.empty ← células antes do dia 1
    │   │   └── .cal-day[data-date="YYYY-MM-DD"]  ← dias do mês
    │   │       ├── .cal-day-num
    │   │       └── .cal-day-tasks
    │   │           ├── .cal-day-task-label (por tarefa)
    │   │           └── .cal-day-more ("+N mais")
    │   └── .cal-selected-panel (opcional, aparece ao clicar num dia)
    │       ├── .cal-selected-panel-title
    │       └── .cal-selected-task (por tarefa)
    │           ├── .cal-selected-task-bar  ← tira colorida por MoSCoW
    │           └── div > .cal-selected-task-title + .cal-selected-task-meta
    └── .cal-sidebar (width 320px, overflow-y auto)
        ├── .cal-sidebar-title
        ├── .cal-drop-hint  ← dica de arrasto
        └── [por faixa de score]
            ├── .cal-sidebar-group-header  ← colorido por faixa
            └── .cal-sidebar-group
                └── task-card + .card-category-tag  ← card completo reutilizado
```

### Grid responsivo ao número de semanas
```js
const numWeeks = Math.ceil((firstWeekday + daysInMonth) / 7);
grid.style.gridTemplateRows = `auto repeat(${numWeeks}, 1fr)`;
```
- Linha `auto` = cabeçalho de dias da semana
- Linhas `1fr` = semanas do mês — sempre preenchem o espaço disponível sem scroll

### Classes CSS do calendário
| Classe | Descrição |
|--------|-----------|
| `.cal-day.today` | Borda e fundo accent (laranja) |
| `.cal-day.selected` | Fundo accent sólido, texto branco |
| `.cal-day.has-overdue` | Borda esquerda vermelha — dia com tarefas atrasadas |
| `.cal-day.drop-target` | Destaque durante drag-over (borda + glow accent) |
| `.cal-sidebar-item.dragging-item` | Opacidade reduzida durante arrasto (legado — itens agora são `.task-card`) |

### Drag-and-drop: sidebar → dias do calendário
- Os cards da sidebar usam o `dragstart` já embutido em `createCard()`, que faz `e.dataTransfer.setData('text/plain', task.id)`
- Cada `.cal-day` tem `dragover` / `dragleave` / `drop`:
  - `dragover`: `e.preventDefault()` + adiciona `.drop-target`
  - `dragleave`: remove `.drop-target` (guarda com `contains` para evitar falso disparo em filhos)
  - `drop`: chama `setTaskDeadline(taskId, dateStr)`

### Função `setTaskDeadline(taskId, dateStr)`
```js
// Remove [prazo: ...] existente, insere novo, atualiza task.deadline, chama markChanged() + renderTasks()
```
- Atualiza tanto `task.title` (persiste no markdown) quanto `task.deadline` (campo in-memory)
- A tarefa sai da sidebar e aparece no calendário após o re-render

### Sidebar: sistema de prioridade por score
As tarefas sem prazo são ordenadas por `calcScore(task, section)` e agrupadas em faixas:

| Faixa | Score | Cor |
|-------|-------|-----|
| 🔴 Alta | ≥ 6 | vermelho |
| 🟡 Média | 3–6 | amarelo |
| 🔵 Baixa | 0,01–3 | azul |
| ⚪ Inativas | 0–0,01 | cinza |

Cada item é um `createCard(task)` completo (checkbox, badges, subtarefas, deps) com uma `.card-category-tag` adicional indicando a seção de origem.

### Navegação de meses
- Botões ← e → criam um `new Date(year, month ± 1, 1)` e chamam `renderTasks()`
- "Hoje" restaura `calendarCurrentDate = new Date()` e limpa `calendarSelectedDate`
- Clicar no mesmo dia selecionado fecha o painel (toggle)

---

## Convenções de CSS Importantes

- `.add-on-hover` — elementos que aparecem no hover da card ("+Add note", "+Add subtask")
  - Usa `opacity: 0 / pointer-events: none` → `opacity: 1 / pointer-events: auto`
  - **NÃO usa `display:none/block`** — evita expansão/colapso do layout no hover
- `.dep-blocked` — card com bloqueios ativos; aplica estilo acinzentado
- `.dep-chip` — chips 🔒/🔑 nas cards
- `.dep-add-btn` — botão 🔗 (min 28×22px para ser clicável)
- `#depPickerOverlay` / `#depPickerContent` — overlay do picker de dependências
- `#depModalOverlay` / `#depModalBox` — modal da cadeia de dependências (ao clicar num chip)

---

## Fluxo de Save/Watch

1. Qualquer mudança chama `markChanged()` → `unsaved = true`
2. Auto-save debounced em `autoSave()`: chama `httpSave('Minhas_Tarefas.md', toMarkdown())` e **logo em seguida atualiza `lastModified = Date.now()`**
3. `toMarkdown()` serializa o estado em memória de volta para markdown (preserva `[#NNN]` e `🔗 #NNN` nos títulos)
4. O watcher (`checkForExternalChanges()`, intervalo de 1 s) compara o `Last-Modified` do servidor com `lastModified`; só recarrega se o arquivo foi alterado **externamente** (ex: Obsidian)
5. Após cada recarga, `assignAndMigrateIds()` é chamado — 4 passos: (1) encontra maior ID existente, (2) atribui `[#NNN]` a tarefas novas, (3) migra deps legados para `🔗 #NNN`, (4) injeta `(adicionado: YYYY-MM-DD)` em tarefas sem data de criação
6. **Atenção:** reload do watcher gera novos `task.id` efêmeros (`Date.now() + Math.random()`). Se o autoSave **não** atualizar `lastModified`, o watcher detecta o próprio save como mudança externa, recria todos os `task.id` e invalida qualquer picker aberto (pickers guardam o `id` antigo → `taskFlatMap[id]` retorna `undefined` → add/remove silenciosamente falha)

---

## Armadilhas Conhecidas

- **Dois tipos de ID coexistem:**
  - `task.id` — efêmero, `Date.now() + Math.random()`, recriado a cada parse. Nunca salvar em markdown. Usar apenas em contexto in-memory (depMap, taskFlatMap, onclick de pickers abertos).
  - `task.taskId` — persistente, inteiro extraído de `[#NNN]` no título. Este sobrevive a reloads e é o referenciado nas deps (`🔗 #NNN`).
- **`assignAndMigrateIds()` deve ser chamado em todos os 5 pontos de carga** — há 5 lugares no código onde `tasks = result.tasks` é atribuído (carregamento inicial, arquivo de concluídas, etc.). Esquecer um ponto deixa tarefas sem `[#NNN]` e deps novas em formato legado.
- **Watcher self-trigger:** se `autoSave` não atualizar `lastModified` após `httpSave`, o watcher detecta o próprio save como edição externa e dispara recarga → novos `task.id` efêmeros → pickers abertos ficam com IDs stale → add/remove falha silenciosamente. Solução: `lastModified = Date.now()` imediatamente após `await httpSave(...)` dentro de `autoSave`.
- **Comparação de IDs em `removeDependency` deve usar `String()`** — onclick HTML sempre passa strings; `task.id` em memória é number. `resolved.id === toId` (strict) falha cross-type. Usar `String(resolved.id) === String(toId)`.
- **Match de deps legado é case-insensitive** — "CIN" bate em "cin", "Cin", etc.
- **"cinzas" não bate em "CIN"** — o word-match verifica token exato, não substring.
- **`renderDepPicker()` não reconstrói o shell** — apenas atualiza as duas sub-seções. Para reabrir em outra tarefa, sempre chamar `showDepPicker(novoId)`.
- **Servidor PowerShell** — se o dashboard mostrar "Erro de rede", o servidor caiu. Reiniciar com o comando acima.
- **`#calendarView` precisa de `display: flex`** — o container usa `flex: 1` herdado do `.tab-panel`, mas só funciona se tiver `display: flex` explícito no próprio elemento (não apenas no pai). Está definido via JS em `switchTaskView` e também via CSS inline no HTML.
- **`calendarCurrentDate` e `calendarSelectedDate` são globais** — persistem entre re-renders. Limpar `calendarSelectedDate = null` ao mudar de mês (botão Hoje) evita painel fantasma.
- **`faixaTasks.forEach` desestrutura `{ task, section, score }`** — o campo `section` é necessário para criar a `.card-category-tag`. Se remover `section` do `scored` array, o tag ficará vazio.
- **Cards da sidebar têm drag nativo do `createCard()`** — o `dragstart` já passa `task.id` via `dataTransfer`. Não adicionar outro `dragstart` por cima ou o evento será duplicado.
- **`grid-template-rows` definido via JS** — o CSS do `.cal-grid` não define linhas, só colunas. As linhas são sempre injetadas no elemento via `grid.style.gridTemplateRows` na renderização. Não colocar `grid-template-rows` no CSS estático.

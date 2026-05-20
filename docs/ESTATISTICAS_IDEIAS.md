# Estatísticas — backlog de ideias

Brainstorm da aba "Estatísticas" das tarefas concluídas. O v1 implementa
apenas um subconjunto; este doc preserva as outras ideias para iterações
futuras.

Dados disponíveis em cada tarefa arquivada (`users/{uid}/completedTasks/`):
- `archivedAt` (Timestamp), `archivedFromSection` (id do projeto original)
- `moscow` (`must` / `should` / `could` / `wont` / `''`)
- `esforco` (`rapido` / `medio` / `longo` / `''`)
- `modo` (`manual` / `colaborar` / `delegar`)
- `deadline`, `addedDate`, `subtasks`, `dependsOn`, `inProgress`

E indiretamente: o `projectScoreMap` (de `buildProjectScoreMap`) para
ponderar tarefas pelo valor do projeto.

## v1 (implementado)

- **Heatmap estilo GitHub contributions** — últimas N semanas, intensidade
  por contagem de tarefas concluídas no dia.
- **Gráfico de barras diário** com toggle **contagem ⇄ score** —
  responde à pergunta original "quantas por dia / soma do score por dia".
- **Cards de resumo** — total no período, melhor dia, média/dia.
- **Filtro de range** — 30d / 90d / 365d.

Score usado para tarefas arquivadas: **valor intrínseco**
`projectScore × moscowPts / effortDiv` (sem bônus de deadline/idade, que
só fazem sentido para tarefas ativas).

## v2 (implementado)

- **Stacked bar por MoSCoW** — cada barra diária dividida em
  must/should/could/wont, com legenda. Diferencia "produtivo" de
  "ocupado": revela se o foco está no que importa ou só em tarefas
  triviais. MoSCoW vazio é agrupado em "could" (mesmo peso de 1 pt,
  mesma cor — evita 5ª categoria visual).
- **Filtro de 7 dias** no toggle de período (além de 30 / 90 / 1 ano).
- **Filtro por projeto** via `ProjectCombobox` na barra de controles
  (`archivedFromSection`, com fallback pro `section` original).

## v3 (implementado)

- **Toggle de dimensão do stack** — barras empilhadas alternam entre
  MoSCoW, Esforço (rapido/medio/longo) e Modo (manual/colaborar/delegar).
  Vazios caem na primeira categoria de mesmo peso (rapido para esforço,
  manual para modo).
- **Card de streak** — maior sequência de dias consecutivos com ≥ 1
  conclusão dentro do período.
- **Card de mediana de ciclo** — `archivedAt - addedDate` em dias,
  mediana sobre as tarefas concluídas no período.
- **Card "no prazo"** — % das tarefas com deadline concluídas até a
  data, mais o N de tarefas que tinham deadline.
- **Delta vs período anterior** — badge "+15% / -8%" no card de "Total
  no período", comparando com período imediatamente anterior de mesmo
  tamanho. Verde se sobe, vermelho se cai, oculto se prev = 0.
- **Por projeto · top 10** — barras horizontais com nome, barra
  proporcional e valor, sorteadas pela métrica ativa. Combina pizza +
  throughput em uma visão. Oculto quando o filtro por projeto está
  ativo (redundante).

## Backlog (pulado por enquanto)

- **Dependency unlocks** — tarefas que mais desbloquearam outras.
  Muito nicho; depende do grafo de dependências computado no
  `ScoreContext`. Volta se houver demanda.
- **Resumo da semana (Spotify Wrapped)** — overlap forte com cards +
  delta. Se voltar, vira página/modal separado de "retrospectiva",
  não card.

## Notas técnicas

- `archivedAt` é o timestamp de quando o `archiveCompletedTasks()`
  rodou (no load do app), não exatamente quando o usuário marcou
  `checked=true`. Para a maioria dos usos, é próximo o suficiente.
  Se um dia precisarmos da hora exata da conclusão, adicionar
  `completedAt` no momento do toggle.
- Adicionar charting library (recharts, visx, chart.js) só quando
  passar de heatmap + barras simples. Para v1, CSS puro basta e
  mantém o bundle PWA enxuto.
- Considerar paginação ou índice no Firestore se o volume passar de
  alguns milhares de docs em `completedTasks/`.

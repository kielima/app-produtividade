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

## Backlog — composição / breakdown

- **Stacked bar por MoSCoW** — cada barra do dia dividida em
  must/should/could/wont. Diferencia "produtivo" de "ocupado": revela
  se o foco está no que importa ou só em tarefas triviais.
- **Stacked bar por esforço** — rapido/medio/longo. Mostra o perfil de
  carga de trabalho.
- **Stacked bar por modo** — manual/colaborar/delegar. Você está
  delegando o que devia?
- **Pizza / treemap por projeto** (`archivedFromSection`) — onde seu
  esforço realmente foi nos últimos 30/90 dias.

## Backlog — qualidade / saúde

- **Tempo de ciclo** — `archivedAt - addedDate` por tarefa.
  Histograma + mediana. Tarefas estão envelhecendo no backlog antes
  de serem concluídas?
- **Cumprimento de deadline** — % concluídas antes vs depois do
  `deadline`. Trend ao longo do tempo.
- **Throughput por projeto** — quantas tarefas/semana cada projeto
  fecha. Identifica projetos parados (sem completions há X semanas).
- **Dependency unlocks** — tarefas que mais desbloquearam outras
  (transitive unlocks).

## Backlog — motivacional / reflexão

- **Recordes pessoais** — melhor dia, melhor semana (por contagem e por
  score). Já parcialmente no v1 (melhor dia).
- **Streak** — dias consecutivos com ≥ N tarefas/score. Cuidado: pode
  virar pressão tóxica; talvez exibir só se ≥ 3 dias.
- **Resumo da semana** — card textual estilo Spotify Wrapped:
  "Você concluiu 23 tarefas (+15% vs semana passada), 8 'must'.
  Projeto X teve mais movimento."
- **Comparativo período atual vs anterior** — % de mudança em todas
  as métricas.

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

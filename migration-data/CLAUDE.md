# Memória de Trabalho

## Eu
**Kiê Lehm** (username: ttibu). Mestrando em Campinas, moro em Taubaté. Viajo toda segunda (08h–11h) para Campinas e volto terça à noite (22h–01h). Musculação qua/qui/sex às 21h30. Natação seg/ter no intervalo do almoço, em Campinas.

## Pessoas
| Quem | Quem é |
|------|--------|
| **Ana** / **Ana Jacintho** | Orientadora da dissertação |
| **Evandro** | Parceiro. Projetos conjuntos: móveis, Postoplastia, Elevação Pessoal |
| **Betânia** | Contacto acadêmico; enviou vídeos do OpenLCA |
| **Eva** | Amiga; estruturando consultório |
| **Rebeca** | Amiga; parceira em rituais (BOS, enterro do crânio do doguinho) |
| **Filipe** | Amigo; recebe runas de presente |
| **Regina** | Colega acadêmica; artigo com intro a criar |
| **Renata** | Colega; tem artigo de opinião sobre qualidade de artigos |
| **Tiago** | Amigo; postectomia pendente |
| **Tio Ari** | Tio; terreno com levantamento topográfico pendente |
| **Nathalia Cavichiolli** | Pesquisadora; tem prompts para RSL |
| **Gustavo Izidro** | Dissertação a fichar |
| **Lilian Corpas** | Dissertação a fichar |

## Termos & Siglas
| Termo | Significado |
|-------|-------------|
| **ACV** | Análise do Ciclo de Vida (LCA) |
| **UHPC** | Ultra-High Performance Concrete (Concreto de Ultra-Alto Desempenho) |
| **RSL** | Revisão Sistemática da Literatura |
| **GWP** | Global Warming Potential (Potencial de Aquecimento Global) |
| **BOS** | Livro das Sombras (Book of Shadows) |
| **CICLO** | Ciclos de Dedicação da Bruxaria (tarefas para o Sacerdócio) |
| **TAP** | Termo de Abertura de Projeto |
| **MoSCoW** | Must / Should / Could / Won't — sistema de prioridade de tarefas |
| **ODS** | Objetivos de Desenvolvimento Sustentável (SDGs da ONU) |
| **ESG** | Environmental, Social and Governance |
| **PICOC** | Participants, Intervention, Comparison, Outcomes, Context |
| **Qualificação** | Exame de qualificação do mestrado (deadline: 2026-06-02) |
| **Defesa** | Defesa UHPC + ACV (deadline: 2026-04-24) |
| **Gravl** | Assistente de IA para treinos físicos (prompt a corrigir) |
| **OpenClaw** | Agente de IA local (Ollama + VM Windows, RTX 4060) |
| **SNotes** | App de notas a migrar |
| **Recime** | App de receitas a migrar |
| **SOWK** | "Minha Terra" — projeto conceitual de habitação sustentável |
| **N8N** | Plataforma de automação de workflows |
| **Semente Ancestral** | Clã de bruxaria — iniciação em curso |
| **Sacerdócio** | Processo de iniciação no clã Semente Ancestral |
| **SAP 3** | Disciplina do mestrado, segunda-feira em Campinas |
| **Infra Verde** | Disciplina do mestrado, terça-feira em Campinas |

## Projetos Principais
| Nome | O que é | Status |
|------|---------|--------|
| **Dissertação / Defesa UHPC+ACV** | Dissertação de mestrado: ACV do UHPC vs concreto convencional | Em andamento — deadline 2026-04-24 |
| **Qualificação** | Banca de qualificação do mestrado | Aguarda dissertação — deadline 2026-06-02 |
| **Automação RSL** | Pipeline automatizado para Revisão Sistemática de Literatura | A iniciar |
| **OpenClaw** | Instalação de agente de IA local via VM + Ollama | Em configuração |
| **Briefing Matinal** | Resumo diário automático ao acordar | A iniciar |
| **Captura Noturna** | Pipeline de ideias noturnas → tarefas no Obsidian | A iniciar |
| **Transformação Corporal** | Programa de hipertrofia com tracking detalhado | A iniciar |
| **Consultório Eva** | Estruturar consultório da Eva (TAP, jurídico, equipamentos) | Em planejamento |
| **SOWK** | Habitação sustentável conceitual (solar, telhado verde) | Conceitual |

## Ferramentas & Stack
- **Obsidian** — vault principal (Minhas_Tarefas.md, Meus_Projetos.md)
- **OpenLCA** — software de ACV
- **N8N** — automações
- **Raindrop** — links salvos
- **Power BI** — dashboards
- **Google Keep** — notas rápidas (a migrar — já exportado em 2026-04-09)
- **Hardware:** Desktop Windows, 32GB RAM, RTX 4060 4GB VRAM

## Preferências
- Usa MoSCoW para prioridade de tarefas (Must/Should/Could/Won't)
- Usa P1/P2/P3 para prioridade de projetos
- Ficheiros em Markdown no Obsidian como sistema central
- Língua: português (pt-BR)

## Dashboard de Produtividade

Aplicação single-file de gestão de tarefas em desenvolvimento ativo.

| Arquivo | Função |
|---------|--------|
| `dashboard.html` | App principal (HTML + CSS + JS inline) |
| `servidor.ps1` | Servidor HTTP PowerShell, porta 8080 |
| `Minhas_Tarefas.md` | Fonte de dados (lida e escrita pelo dashboard) |
| `tarefas_concluidas.md` | Arquivo automático de tarefas concluídas |
| `DASHBOARD_CONTEXTO.md` | **Referência técnica completa** para desenvolvimento |

**Iniciar servidor:**
```powershell
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File 'C:\Users\ttibu\Documents\06_PRODUTIVIDADE\servidor.ps1'"
```
Depois abrir: `http://localhost:8080/dashboard.html`

**Notas rápidas para IA:**
- **Dois tipos de ID coexistem:**
  - `task.id` — efêmero, `Date.now() + Math.random()`, recriado a cada parse. Nunca salvar em markdown. Usar só em contexto in-memory.
  - `task.taskId` — persistente, inteiro extraído de `[#NNN]` no título (ex: `[#0042]`). Sobrevive a reloads. É o referenciado nas deps e no markdown.
- `assignAndMigrateIds()` atribui `[#NNN]` a tarefas novas e migra deps legados — deve ser chamado em todos os 5 pontos de carga
- Dependências ficam embutidas no título como `🔗 #NNN` (ex: `🔗 #0042`). Formato legado `🔗 PrimeirasQuatroP` ainda é lido e migrado automaticamente
- Match de deps: primeiro por ID exato (`#NNN` → `taskIdMap`), depois word-boundary com fallback substring (legado)
- Ver `DASHBOARD_CONTEXTO.md` para arquitetura completa, convenções CSS, fluxo de save e armadilhas conhecidas

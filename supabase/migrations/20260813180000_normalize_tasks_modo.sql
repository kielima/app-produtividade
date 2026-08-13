-- Normaliza `tasks.modo` para a união que o app conhece hoje:
-- manual/delegar/cowork/design/code/chat.
--
-- A coluna é `text` livre (sem CHECK, sem enum) e acumulou valores de várias
-- versões do app. Levantamento em 2026-08-13, antes desta migration:
--
--   manual 516 · colaborar 122 · delegar 104 · cowork 10 · '' 7 · Manual 4
--   · code 2 · null 1 · chat 1
--
-- `colaborar` é o rótulo de antes da troca das tags de Modo (#422). A
-- migration que faria essa conversão (20260808120000) nunca chegou a rodar
-- neste projeto e ficou apontando para `public.tasks`, tabela que mudou de
-- schema depois; esta refaz a conversão no lugar certo. `Manual` (com
-- maiúscula) e `''` vêm do dashboard.html, anterior ao app.
--
-- Por que importa: a tela de Estatísticas agrupa as tarefas concluídas por
-- modo indexando um mapa com uma entrada por valor conhecido. Com
-- `colaborar` no meio (45 das concluídas), a busca caía em `undefined` e a
-- exceção derrubava a árvore React inteira — a tela ficava vazia e o app
-- inteiro sumia. O app já não depende mais desta limpeza: passou a
-- normalizar os três campos categóricos na leitura do banco
-- (src/lib/taskFields.ts), então o valor legado é tratado como `chat` na
-- interface mesmo antes de o dado ser corrigido. Esta migration só faz o
-- banco concordar com o que a tela já mostra.
--
-- `moscow` e `esforco` foram conferidos na mesma data e já continham apenas
-- valores válidos (mais `''`/null, que o app lê como "sem classificação"),
-- por isso ficam de fora.
--
-- APLICADA em 2026-08-13 no projeto robwqxgllzxbxwnjkyic (produtividade),
-- como `normalize_tasks_modo`. Distribuição depois, nas mesmas 767 tarefas:
--
--   manual 528 · chat 123 · delegar 104 · cowork 10 · code 2
--
-- Bate com o esperado: os 122 `colaborar` foram para `chat` (1 + 122 = 123)
-- e os 12 restantes — 4 `Manual`, 7 `''`, 1 null — para `manual`
-- (516 + 12 = 528). Nenhum valor fora da união sobrou.

update produtividade.tasks
set modo = 'chat'
where lower(btrim(modo)) = 'colaborar';

update produtividade.tasks
set modo = lower(btrim(modo))
where modo is not null
  and modo <> lower(btrim(modo))
  and lower(btrim(modo)) in ('manual', 'delegar', 'cowork', 'design', 'code', 'chat');

-- Sobra: vazio, null e qualquer outro rótulo desconhecido. O app já lê todos
-- eles como "manual" — é o mesmo padrão de `normalizeModo()`.
update produtividade.tasks
set modo = 'manual'
where modo is null
  or modo not in ('manual', 'delegar', 'cowork', 'design', 'code', 'chat');

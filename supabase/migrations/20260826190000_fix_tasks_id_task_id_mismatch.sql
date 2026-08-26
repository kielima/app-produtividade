-- Corrige tarefas cujo `id` não bate com `task_id`.
--
-- O app assume em todo lugar que `id = String(task_id)` — é o que
-- `taskDocId()` calcula em `src/repositories/tasksRepo.ts` para montar a
-- linha antes de qualquer upsert. 53 tarefas de um único usuário quebravam
-- essa regra: tinham `id` de outra origem (a maioria UUIDs tipo
-- `4d9f195d-...`, algumas com slug tipo `rsl-e3`) enquanto `task_id` seguia
-- a numeração sequencial normal do app — sinal de terem sido inseridas por
-- fora do fluxo do app (script/skill gravando direto no banco), sem
-- respeitar o invariante.
--
-- Isso é inofensivo até alguém tentar editar uma dessas tarefas pelo app: o
-- upsert calcula `id = String(task_id)` — diferente do `id` real da linha —
-- e vira um INSERT em vez de um UPDATE, que esbarra no
-- `unique (user_id, task_id)` e falha com "duplicate key value violates
-- unique constraint tasks_user_id_task_id_key". Foi o que aconteceu ao
-- tentar concluir "Criar meu logotipo" (id real
-- `4d9f195d-b16c-47f2-bdfe-f829bf6007ab`, task_id 1306): o upsert tentou
-- inserir uma segunda linha com id `1306` e mesmo `task_id`.
--
-- Conferido antes de aplicar: nenhuma linha referencia esses ids via
-- `tasks.parent_id` ou `annotations.linked_task_id`, e nenhum `task_id::text`
-- colide com um `id` já existente — a correção é só reescrever `id` mesmo,
-- sem precisar tocar em referência nenhuma.
--
-- APLICADA em 2026-08-26 no projeto robwqxgllzxbxwnjkyic (produtividade),
-- como `fix_tasks_id_task_id_mismatch`: 53 linhas corrigidas.

update produtividade.tasks
set id = task_id::text
where task_id is not null
  and id <> task_id::text;

-- Guarda-corpo: qualquer futura gravação (pelo app ou por fora dele) que
-- quebre `id = task_id` de novo falha na hora, com um erro que aponta pra
-- causa — em vez de ficar dormente até alguém tocar na tarefa errada meses
-- depois.
alter table produtividade.tasks
  add constraint tasks_id_matches_task_id
  check (task_id is null or id = task_id::text);

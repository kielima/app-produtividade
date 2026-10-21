-- Gravação em lote do espelho de score (colunas score/score_breakdown/
-- score_updated_at, ver 20260916120000_add_tasks_score_columns). Antes o app
-- mandava um PATCH por tarefa; com o score dependendo da data corrente, todas
-- as tarefas abertas mudam uma vez por dia e isso virava centenas de
-- requisições de uma vez. Esta função aplica todas num único UPDATE.
--
-- `updates` é um array JSON de { id, score, breakdown }. `security invoker`
-- mantém a RLS de `tasks` valendo, e o filtro por `auth.uid()` impede tocar
-- linhas de outro usuário mesmo que a RLS mude.
create or replace function produtividade.update_task_scores(updates jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update produtividade.tasks t
     set score = u.score,
         score_breakdown = u.breakdown,
         score_updated_at = now()
    from jsonb_to_recordset(updates) as u(id text, score numeric, breakdown jsonb)
   where t.id = u.id
     and t.user_id = auth.uid();
$$;

revoke all on function produtividade.update_task_scores(jsonb) from public, anon;
grant execute on function produtividade.update_task_scores(jsonb) to authenticated;

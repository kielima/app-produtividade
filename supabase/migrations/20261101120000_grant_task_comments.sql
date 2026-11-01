-- A migration 20261031120000_add_task_comments criou as tabelas sem `grant`
-- para `authenticated` — sem ele o PostgREST responde "permission denied"
-- mesmo com a policy de RLS certa. O RLS por `user_id` continua sendo o que
-- isola as linhas de cada usuário.
grant select, insert, update, delete
  on produtividade.task_comments, produtividade.task_comment_anexos
  to authenticated;

notify pgrst, 'reload schema';

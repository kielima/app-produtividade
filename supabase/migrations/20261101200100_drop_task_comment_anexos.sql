-- Segunda metade de 20261101200000: os comentários de tarefa deixam de ter
-- anexos. A tabela estava vazia (nada a migrar). Aplicar só depois do deploy
-- da versão que já não a lê. O bucket `task-comment-anexos` também estava
-- vazio e fica sem uso (apagar bucket por SQL não é suportado pelo Storage).
drop table if exists produtividade.task_comment_anexos;
drop policy if exists "owner_all_task_comment_anexos" on storage.objects;

notify pgrst, 'reload schema';

-- O campo `modo` de tasks passou de 3 valores (manual/colaborar/delegar)
-- para 5 (manual/delegar/cowork/code/chat). "Colaborar" não tem sucessor
-- direto entre os novos; migramos as tarefas existentes para "chat".
update public.tasks
set modo = 'chat'
where modo = 'colaborar';

-- O campo `modo` de tasks passou de 3 valores (manual/colaborar/delegar)
-- para 5 (manual/delegar/cowork/code/chat). "Colaborar" não tem sucessor
-- direto entre os novos; migramos as tarefas existentes para "chat".
--
-- NUNCA FOI APLICADA no projeto robwqxgllzxbxwnjkyic — não consta no
-- histórico de migrations do remoto, e em 2026-08-13 ainda havia 122 tarefas
-- com `modo = 'colaborar'` lá. O sucessor
-- (`20260813180000_normalize_tasks_modo.sql`) refaz esta conversão já no
-- schema certo e cobre também os outros valores fora da união.
--
-- A tabela saiu de `public` em `20260812120000_move_public_to_produtividade_
-- schema.sql`, então este arquivo ficou apontando para uma tabela que não
-- existe mais: sem a guarda abaixo, um `supabase db push` numa base nova
-- quebraria aqui.
do $$
begin
  if to_regclass('public.tasks') is not null then
    update public.tasks
    set modo = 'chat'
    where modo = 'colaborar';
  end if;
end
$$;

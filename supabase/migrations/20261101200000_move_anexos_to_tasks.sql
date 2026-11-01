-- Anexos (fotos/PDFs) passam a ser da TAREFA, não dos comentários: pedido da
-- Kiê — comentário é só conversa em texto. A remoção da tabela antiga fica
-- na migration seguinte (20261101200100), aplicada só depois do deploy: a
-- versão anterior do app ainda lê `task_comment_anexos` ao abrir comentários.

create table produtividade.task_anexos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  task_id     text not null references produtividade.tasks(id) on delete cascade,
  path        text not null,
  nome        text not null,
  tipo        text not null,
  bytes       integer not null,
  criado_em   timestamptz not null default now()
);

create index task_anexos_task_id_idx on produtividade.task_anexos(task_id);
create index task_anexos_user_id_idx on produtividade.task_anexos(user_id);

alter table produtividade.task_anexos enable row level security;
create policy "owner_all" on produtividade.task_anexos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on produtividade.task_anexos to authenticated;
alter table produtividade.task_anexos replica identity full;
alter publication supabase_realtime add table produtividade.task_anexos;

-- Bucket privado; acesso só por URL assinada. Caminho:
-- "<uid>/<task_id>/<nome-gerado>" — o prefixo do uid é o que a policy confere.
insert into storage.buckets (id, name, public)
values ('task-anexos', 'task-anexos', false)
on conflict (id) do nothing;

create policy "owner_all_task_anexos" on storage.objects
  for all
  using (bucket_id = 'task-anexos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'task-anexos' and auth.uid()::text = (storage.foldername(name))[1]);

notify pgrst, 'reload schema';

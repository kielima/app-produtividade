-- Comentários nos projetos (só texto), como já existem nas tarefas e nas
-- notas. É por aqui que o secretário agendado pede o contexto que falta num
-- projeto (objetivo, status atual, próximos passos, prazo, prioridade) e a
-- Kiê responde — ver docs/SECRETARIO.md §5b. Entram também no filtro
-- "esperando minha resposta".
create table produtividade.project_comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  text not null references produtividade.projects(id) on update cascade on delete cascade,
  texto       text not null default '',
  autor_nome  text,
  autor_email text,
  criado_em   timestamptz not null default now()
);

create index project_comments_project_id_idx on produtividade.project_comments(project_id);
create index project_comments_user_id_idx on produtividade.project_comments(user_id);

alter table produtividade.project_comments enable row level security;
create policy "owner_all" on produtividade.project_comments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on produtividade.project_comments to authenticated;
alter table produtividade.project_comments replica identity full;
alter publication supabase_realtime add table produtividade.project_comments;

notify pgrst, 'reload schema';

-- Comentários nas tarefas, igual ao que já existe na aba Tarefas do painel
-- da Sudeste (kielima.com/sdt/tarefas) — pedido da Kiê, que quer poder
-- delegar tarefas para outras pessoas e precisa de um jeito de conversar
-- sobre uma tarefa sem apagar a nota principal dela.
--
-- Diferença importante do modelo da Sudeste: lá o acesso é por Worker, com
-- permissões por área e várias pessoas na mesma base. Aqui o Supabase é
-- lido direto do navegador, então o isolamento é só RLS por `user_id` (como
-- toda tabela deste app). Hoje só a Kiê loga, mas `autor_nome`/`autor_email`
-- já vêm do perfil do Google (ver src/lib/auth.ts) para quando outras
-- contas comentarem.
--
-- Anexos ficam numa tabela própria (não um array jsonb) para poderem ser
-- apagados do Storage individualmente e ter FK de cascade com o comentário.

create table produtividade.task_comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  task_id     text not null references produtividade.tasks(id) on delete cascade,
  texto       text not null default '',
  autor_nome  text,
  autor_email text,
  criado_em   timestamptz not null default now()
);

create index task_comments_task_id_idx on produtividade.task_comments(task_id);
create index task_comments_user_id_idx on produtividade.task_comments(user_id);

create table produtividade.task_comment_anexos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  comment_id  uuid not null references produtividade.task_comments(id) on delete cascade,
  path        text not null,
  nome        text not null,
  tipo        text not null,
  bytes       integer not null,
  criado_em   timestamptz not null default now()
);

create index task_comment_anexos_comment_id_idx on produtividade.task_comment_anexos(comment_id);

alter table produtividade.task_comments       enable row level security;
alter table produtividade.task_comment_anexos enable row level security;

create policy "owner_all" on produtividade.task_comments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on produtividade.task_comment_anexos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table
  produtividade.task_comments, produtividade.task_comment_anexos;

-- --- STORAGE: um bucket privado para as fotos/arquivos dos comentários -----
--
-- Privado (nunca servido por URL pública) — como todo anexo da Sudeste, o
-- acesso é sempre por URL assinada (`createSignedUrl`), de duração curta,
-- gerada só para quem a RLS do bucket deixa ver o objeto.
--
-- Caminho do arquivo: "<uid>/<comment_id>/<nome-gerado>". O prefixo do uid é
-- o que a policy abaixo confere — storage.objects não tem `user_id` próprio
-- neste bucket, então o dono é quem criou o objeto (`storage.foldername`).
insert into storage.buckets (id, name, public)
values ('task-comment-anexos', 'task-comment-anexos', false)
on conflict (id) do nothing;

create policy "owner_all_task_comment_anexos" on storage.objects
  for all
  using (bucket_id = 'task-comment-anexos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'task-comment-anexos' and auth.uid()::text = (storage.foldername(name))[1]);

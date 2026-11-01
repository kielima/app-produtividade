-- Atribuição de tarefas a "recursos" (pessoas ou o Claude), repositórios do
-- GitHub vinculados a projetos e comentários nas notas — base para delegar
-- tarefas e para o "secretário" agendado, que lê/escreve direto nestas
-- tabelas (ver docs/SECRETARIO.md).

-- --- RECURSOS ---------------------------------------------------------------
-- Quem pode executar uma tarefa. `foto` guarda uma imagem já reduzida como
-- data URL (≈20–40 KB) ou o caminho de um asset público do app (ex.:
-- 'recursos/claude.svg'): o avatar aparece em todo card de tarefa, então
-- buscar uma URL assinada do Storage para cada card seria caro demais.
-- `descricao` diz que tipo de tarefa o recurso pode fazer — é o que ajuda a
-- decidir a quem delegar.
create table produtividade.resources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  nome        text not null,
  foto        text,
  descricao   text not null default '',
  tipo        text not null default 'pessoa' check (tipo in ('pessoa', 'ia')),
  ordem       integer,
  criado_em   timestamptz not null default now()
);

create index resources_user_id_idx on produtividade.resources(user_id);

alter table produtividade.resources enable row level security;
create policy "owner_all" on produtividade.resources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on produtividade.resources to authenticated;
-- FULL para o DELETE chegar pelo Realtime com `user_id` (ver 20260804120000).
alter table produtividade.resources replica identity full;
alter publication supabase_realtime add table produtividade.resources;

-- --- RESPONSÁVEL DA TAREFA -------------------------------------------------
-- Substitui o "Modo" na interface. A coluna `modo` continua existindo (o
-- dashboard local e o título serializado ainda a usam), mas o app passa a
-- mostrar e filtrar pelo responsável.
alter table produtividade.tasks
  add column responsavel_id uuid references produtividade.resources(id) on delete set null;
create index tasks_responsavel_id_idx on produtividade.tasks(responsavel_id);

-- --- REPOSITÓRIOS DO GITHUB NOS PROJETOS -----------------------------------
-- "owner/repo". Array porque um projeto pode ter vários repositórios e o
-- mesmo repositório pode aparecer em mais de um projeto.
alter table produtividade.projects
  add column github_repos text[] not null default '{}';

-- --- COMENTÁRIOS NAS NOTAS ---------------------------------------------------
-- Só texto (as notas já têm corpo e itens próprios). É onde o secretário
-- deixa perguntas e sugestões sobre a nota.
create table produtividade.note_comments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  note_id     text not null references produtividade.notes(id) on delete cascade,
  texto       text not null default '',
  autor_nome  text,
  autor_email text,
  criado_em   timestamptz not null default now()
);

create index note_comments_note_id_idx on produtividade.note_comments(note_id);
create index note_comments_user_id_idx on produtividade.note_comments(user_id);

alter table produtividade.note_comments enable row level security;
create policy "owner_all" on produtividade.note_comments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on produtividade.note_comments to authenticated;
alter table produtividade.note_comments replica identity full;
alter publication supabase_realtime add table produtividade.note_comments;

-- Os comentários de tarefa (20261031120000) nasceram sem REPLICA IDENTITY
-- FULL: apagar um comentário não sumia da tela até recarregar.
alter table produtividade.task_comments       replica identity full;
alter table produtividade.task_comment_anexos replica identity full;

notify pgrst, 'reload schema';

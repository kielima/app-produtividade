-- Correção fundamental: todo id desta app é uma string escolhida pela
-- aplicação (slug do projeto, taskId numérico como string, ou um id
-- aleatório tipo doc-id do Firestore) — nunca um inteiro gerado pelo banco.
-- A migração inicial (20260726060000) usou bigint identity por engano.
-- Também a maioria dos campos "de data" (deadline, addedDate,
-- lastOpenedAt, createdAt de annotation etc.) são strings simples no app
-- (não Date/Timestamp) — só Task.completedAt é de fato um timestamp real.
-- Sem dados reais no projeto ainda, dropar e recriar as tabelas afetadas
-- é seguro. Ver PLANO_MIGRACAO_SUPABASE.md.

drop table if exists public.annotations cascade;
drop table if exists public.reading_items cascade;
drop table if exists public.notes cascade;
drop table if exists public.project_ratings cascade;
drop table if exists public.tasks cascade;
drop table if exists public.projects cascade;

create table public.projects (
  id                    text primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  area                  text,
  categories            text[] not null default '{}',
  status                text,
  priority              text check (priority in ('P1','P2','P3','')),
  moscow                text,
  objective             text,
  current_status        text,
  next_steps            text,
  deadline              text,
  estimated_duration    text,
  depends_on            text references public.projects(id) on delete set null,
  notes                 text,
  "order"               integer,
  status_before_block   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.tasks (
  id                          text primary key,
  user_id                     uuid not null references auth.users(id) on delete cascade,
  task_id                     integer,
  title                       text not null,
  note                        text,
  checked                     boolean not null default false,
  in_progress                 boolean not null default false,
  moscow                      text,
  modo                        text,
  esforco                     text,
  deadline                    text,
  added_date                  text,
  depends_on                  text[] not null default '{}',
  subtasks                    jsonb not null default '[]',
  parent_id                   text references public.tasks(id) on delete set null,
  "order"                     integer,
  project_id                  text references public.projects(id) on delete set null,
  completed_at                timestamptz,
  completed_from_section_name text,
  snoozed_until               text,
  source_item_id              text,
  source_annotation_id        text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id, task_id)
);

create table public.project_ratings (
  project_id  text primary key references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  r           double precision not null,
  rd          double precision not null,
  sigma       double precision not null,
  updated_at  timestamptz not null default now()
);

create table public.notes (
  id                    text primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  title                 text,
  note                  text,
  items                 jsonb not null default '[]',
  added_date            text,
  tags                  text[] not null default '{}',
  pinned                boolean not null default false,
  project_id            text references public.projects(id) on delete set null,
  color                 text,
  source_item_id        text,
  source_annotation_id  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.reading_items (
  id                    text primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  drive_file_id         text,
  file_name             text,
  folder_id             text,
  folder_path           text,
  format                text check (format in ('pdf','epub')),
  title                 text,
  authors               text[] not null default '{}',
  item_type             text,
  doi                   text,
  isbn                  text,
  issn                  text,
  year                  text,
  publication           text,
  tags                  text[] not null default '{}',
  added_date            text,
  last_opened_at        text,
  auto_classified_at    text,
  reading_status        text,
  current_page          integer,
  project_id            text references public.projects(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.annotations (
  id                text primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  reading_item_id   text not null references public.reading_items(id) on delete cascade,
  page              integer not null,
  type              text check (type in ('highlight','comment','ink')),
  color             text,
  rects             jsonb,
  text              text,
  title             text,
  comment           text,
  strokes           jsonb,
  anchor            jsonb,
  cfi               text,
  created_at        text,
  linked_task_id    text references public.tasks(id) on delete set null,
  linked_note_id    text references public.notes(id) on delete set null
);

create index tasks_user_id_idx on public.tasks(user_id);
create index tasks_project_id_idx on public.tasks(project_id);
create index projects_user_id_idx on public.projects(user_id);
create index notes_user_id_idx on public.notes(user_id);
create index reading_items_user_id_idx on public.reading_items(user_id);
create index annotations_reading_item_idx on public.annotations(reading_item_id);

alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.project_ratings   enable row level security;
alter table public.notes             enable row level security;
alter table public.reading_items     enable row level security;
alter table public.annotations       enable row level security;

create policy "owner_all" on public.projects        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.tasks           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.project_ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.notes           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.reading_items   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.annotations     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.tasks, public.projects, public.notes, public.reading_items, public.annotations, public.project_ratings;

-- Schema inicial da migração Firebase → Supabase.
-- Ver PLANO_MIGRACAO_SUPABASE.md §2.2. Já aplicado ao projeto via MCP;
-- este arquivo é a versão de controle (supabase db push) desse mesmo DDL.

-- ============================================================
-- SCHEMA public — tabelas expostas via PostgREST, protegidas por RLS
-- ============================================================

create table public.projects (
  id                    bigint generated always as identity primary key,
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
  deadline              timestamptz,
  estimated_duration    text,
  depends_on            bigint references public.projects(id) on delete set null,
  notes                 text,
  "order"               integer,
  status_before_block   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.tasks (
  id                          bigint generated always as identity primary key,
  user_id                     uuid not null references auth.users(id) on delete cascade,
  task_number                 integer,
  title                       text not null,
  note                        text,
  checked                     boolean not null default false,
  in_progress                 boolean not null default false,
  moscow                      text,
  modo                        text,
  esforco                     text,
  deadline                    timestamptz,
  added_date                  timestamptz not null default now(),
  depends_on                  integer[] not null default '{}',
  subtasks                    jsonb not null default '[]',
  parent_id                   bigint references public.tasks(id) on delete set null,
  "order"                     integer,
  project_id                  bigint references public.projects(id) on delete set null,
  completed_at                timestamptz,
  completed_from_section_name text,
  snoozed_until               timestamptz,
  source_item_id              bigint,
  source_annotation_id        bigint,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id, task_number)
);

create table public.project_ratings (
  project_id  bigint primary key references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  r           double precision not null,
  rd          double precision not null,
  sigma       double precision not null,
  updated_at  timestamptz not null default now()
);

create table public.notes (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  title                 text,
  note                  text,
  items                 jsonb not null default '[]',
  added_date            timestamptz not null default now(),
  tags                  text[] not null default '{}',
  pinned                boolean not null default false,
  project_id            bigint references public.projects(id) on delete set null,
  color                 text,
  source_item_id        bigint,
  source_annotation_id  bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.reading_items (
  id                    bigint generated always as identity primary key,
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
  year                  integer,
  publication           text,
  tags                  text[] not null default '{}',
  added_date            timestamptz not null default now(),
  last_opened_at        timestamptz,
  auto_classified_at    timestamptz,
  reading_status        text,
  current_page          integer,
  project_id            bigint references public.projects(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.annotations (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  reading_item_id   bigint not null references public.reading_items(id) on delete cascade,
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
  created_at        timestamptz not null default now(),
  linked_task_id    bigint references public.tasks(id) on delete set null,
  linked_note_id    bigint references public.notes(id) on delete set null
);

create table public.memory_docs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  namespace   text not null check (namespace in ('glossary','claude','projects_context','automations','context')),
  slug        text,
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  unique (user_id, namespace, slug)
);

create table public.connection_status (
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('calendar','drive')),
  connected     boolean not null default false,
  connected_at  timestamptz,
  primary key (user_id, provider)
);

create index tasks_user_id_idx on public.tasks(user_id);
create index tasks_project_id_idx on public.tasks(project_id);
create index projects_user_id_idx on public.projects(user_id);
create index notes_user_id_idx on public.notes(user_id);
create index reading_items_user_id_idx on public.reading_items(user_id);
create index annotations_reading_item_idx on public.annotations(reading_item_id);
create index memory_docs_user_id_idx on public.memory_docs(user_id);

alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.project_ratings   enable row level security;
alter table public.notes             enable row level security;
alter table public.reading_items     enable row level security;
alter table public.annotations       enable row level security;
alter table public.memory_docs       enable row level security;
alter table public.connection_status enable row level security;

create policy "owner_all" on public.projects        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.tasks           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.project_ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.notes           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.reading_items   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.annotations     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all" on public.memory_docs     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- connection_status: cliente só lê, só service_role (Edge Functions) escreve
create policy "owner_read" on public.connection_status for select using (auth.uid() = user_id);

-- realtime: habilita replicação p/ as tabelas que hoje usam onSnapshot no Firestore
alter publication supabase_realtime add table public.tasks, public.projects, public.notes, public.reading_items, public.annotations, public.project_ratings;

-- ============================================================
-- SCHEMA private — nunca exposto via API REST (equivalente a
-- "allow read, write: if false" nas firestore.rules atuais)
-- ============================================================
create schema if not exists private;

create table private.oauth_tokens (
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null check (provider in ('calendar','drive')),
  refresh_token  text not null,
  scope          text,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, provider)
);

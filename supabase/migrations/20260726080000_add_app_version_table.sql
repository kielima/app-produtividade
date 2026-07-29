-- Checador de atualização do APK (era o doc público `app/versao` no Firestore).
-- Tabela singleton, leitura pública (equivalente a "allow read: if true"),
-- escrita só via service_role (script de CI), nunca pelo cliente autenticado.
create table public.app_version (
  id            int primary key default 1,
  commit        text,
  apk_url       text,
  atualizado_em timestamptz not null default now(),
  constraint app_version_singleton check (id = 1)
);
alter table public.app_version enable row level security;
create policy "app_version_public_read" on public.app_version for select using (true);

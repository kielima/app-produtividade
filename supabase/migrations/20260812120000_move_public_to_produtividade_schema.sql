-- Consolidação dos dois projetos Supabase num só.
--
-- Este projeto passa a hospedar também o app wishlist, que ganhou o schema
-- `wishlist`. Para manter a simetria e isolar os dois apps, as tabelas do
-- app-produtividade saem do `public` para o schema `produtividade`.
--
-- O que motivou: as duas bases tinham uma tabela `app_version` cada, com
-- formatos diferentes (id int4 vs int2, `atualizado_em` vs `updated_at`,
-- nullability distinta) e ciclos de release independentes — precisam coexistir
-- como duas linhas separadas. Um schema por app resolve a colisão sem prefixo
-- de nome e deixa `public` livre.
--
-- `ALTER TABLE ... SET SCHEMA` move a tabela preservando dados, tipos, PKs,
-- FKs, índices, constraints, RLS policies, grants e a inscrição na publicação
-- `supabase_realtime` — nada é recriado, nenhuma linha é reescrita.
--
-- ATENÇÃO — ORDEM DE APLICAÇÃO. Esta migration e o deploy do front precisam
-- sair juntos: enquanto o build publicado ainda apontar para `public`, ele não
-- enxerga as tabelas. Aplique a migration e em seguida rode o deploy; uma aba
-- já aberta precisa de um reload. Ver PLANO_MIGRACAO_SUPABASE.md.
--
-- Depende de: "Exposed schemas" (Project Settings > API) conter
-- `produtividade` e `wishlist`, senão o PostgREST recusa tudo.

create schema if not exists produtividade;

grant usage on schema produtividade to anon, authenticated, service_role;

alter table public.tasks             set schema produtividade;
alter table public.projects          set schema produtividade;
alter table public.notes             set schema produtividade;
alter table public.reading_items     set schema produtividade;
alter table public.annotations       set schema produtividade;
alter table public.project_ratings   set schema produtividade;
alter table public.memory_docs       set schema produtividade;
alter table public.connection_status set schema produtividade;
alter table public.app_version       set schema produtividade;

-- Tabelas futuras neste schema herdam o mesmo tratamento que tinham no public.
alter default privileges in schema produtividade grant all on tables to service_role;

-- `private.oauth_tokens` continua onde está: é lida por conexão direta ao
-- Postgres com nome qualificado (supabase/functions/_shared/google.ts), de
-- propósito fora do PostgREST.

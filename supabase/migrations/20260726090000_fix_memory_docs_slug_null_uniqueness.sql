-- NULL != NULL em constraints UNIQUE do Postgres: com slug NULL para os docs
-- singleton (glossary/claude), o upsert em (user_id, namespace, slug) nunca
-- detectaria conflito e duplicaria a linha a cada import. Usar '' como
-- sentinela resolve, já que '' = '' é uma igualdade normal.
alter table public.memory_docs alter column slug set default '';
update public.memory_docs set slug = '' where slug is null;
alter table public.memory_docs alter column slug set not null;

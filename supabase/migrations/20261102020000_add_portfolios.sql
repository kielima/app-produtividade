-- Portfólios (conceito do PMI): agrupam projetos e processos sob um objetivo
-- estratégico. Quem gere o portfólio — priorizar, equilibrar, pausar e
-- despausar componentes — é o secretário agendado (docs/SECRETARIO.md §5d);
-- `gestao` é o panorama que ele escreve e o app mostra na aba Portfólios.
create table produtividade.portfolios (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  nome                 text not null,
  objetivo             text not null default '',
  ordem                integer,
  gestao               text not null default '',
  gestao_atualizada_em timestamptz,
  criado_em            timestamptz not null default now()
);

create index portfolios_user_id_idx on produtividade.portfolios(user_id);

alter table produtividade.portfolios enable row level security;
create policy "owner_all" on produtividade.portfolios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on produtividade.portfolios to authenticated;
alter table produtividade.portfolios replica identity full;
alter publication supabase_realtime add table produtividade.portfolios;

-- Um projeto/processo pertence a no máximo um portfólio (como no PMI).
alter table produtividade.projects
  add column portfolio_id uuid references produtividade.portfolios(id) on delete set null;
create index projects_portfolio_id_idx on produtividade.projects(portfolio_id);

-- Pausa decidida pelo secretário: o motivo aparece na página do projeto e o
-- status anterior é o que volta ao despausar. Diferente de
-- status_before_block, que é a pausa automática por dependência (do app).
alter table produtividade.projects
  add column pausa_motivo text,
  add column status_antes_pausa text;

notify pgrst, 'reload schema';

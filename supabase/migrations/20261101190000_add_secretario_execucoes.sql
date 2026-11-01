-- Histórico das passadas do secretário agendado (ver docs/SECRETARIO.md):
-- uma linha por execução, com o resumo do que foi feito. Serve para auditar
-- o que a automação mexeu e para a passada seguinte saber onde a anterior
-- parou. Escrita só pela automação (via service role); o app só lê.
create table produtividade.secretario_execucoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  iniciado_em   timestamptz not null default now(),
  terminado_em  timestamptz,
  tarefas       text[] not null default '{}',
  notas         text[] not null default '{}',
  resumo        text not null default ''
);

create index secretario_execucoes_user_idx
  on produtividade.secretario_execucoes(user_id, iniciado_em desc);

alter table produtividade.secretario_execucoes enable row level security;
create policy "owner_read" on produtividade.secretario_execucoes
  for select using (auth.uid() = user_id);
grant select on produtividade.secretario_execucoes to authenticated;

notify pgrst, 'reload schema';

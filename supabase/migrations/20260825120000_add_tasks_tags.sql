-- Tags para tarefas, no mesmo padrão já usado em notes/reading_items:
-- coluna `text[]` livre na própria tabela, sem tabela de tags separada.
alter table produtividade.tasks
  add column tags text[] not null default '{}';

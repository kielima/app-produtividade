-- Lista "Meu dia": tarefas que o usuário escolheu fazer no dia, na ordem em
-- que quer vê-las. Uma única coluna guarda as duas coisas:
--   * null  -> a tarefa não está no "Meu dia";
--   * valor -> está, e a ordem crescente dos valores é a ordem da lista.
-- A coluna fica na própria linha da tarefa (e não numa tabela à parte) para
-- viajar junto com o Realtime e com o export/import já existentes.
alter table produtividade.tasks
  add column my_day_order double precision;

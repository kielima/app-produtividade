-- Apagar um projeto falhava com 409 (violação de FK) sempre que algo ainda
-- apontava para ele: as FKs para `projects` só tinham ON UPDATE CASCADE, sem
-- regra de ON DELETE. O caso mais comum era o rating do Duelo
-- (`project_ratings`) — todo projeto que já passou por um duelo ficava
-- impossível de apagar.
--
--   * project_ratings, tasks -> ON DELETE CASCADE: não fazem sentido sem o
--     projeto (o app já pedia confirmação para apagar as tarefas junto). Com
--     o cascade, apagar o projeto passa a ser uma única operação atômica.
--   * notes, reading_items   -> ON DELETE SET NULL: a nota/leitura continua
--     existindo, só perde o vínculo.
--   * projects.depends_on    -> ON DELETE SET NULL: o dependente deixa de
--     estar bloqueado (o app reverte a auto-pausa sozinho).

alter table produtividade.project_ratings
  drop constraint project_ratings_project_id_fkey,
  add constraint project_ratings_project_id_fkey foreign key (project_id)
    references produtividade.projects(id) on update cascade on delete cascade;

alter table produtividade.tasks
  drop constraint tasks_project_id_fkey,
  add constraint tasks_project_id_fkey foreign key (project_id)
    references produtividade.projects(id) on update cascade on delete cascade;

alter table produtividade.notes
  drop constraint notes_project_id_fkey,
  add constraint notes_project_id_fkey foreign key (project_id)
    references produtividade.projects(id) on update cascade on delete set null;

alter table produtividade.reading_items
  drop constraint reading_items_project_id_fkey,
  add constraint reading_items_project_id_fkey foreign key (project_id)
    references produtividade.projects(id) on update cascade on delete set null;

alter table produtividade.projects
  drop constraint projects_depends_on_fkey,
  add constraint projects_depends_on_fkey foreign key (depends_on)
    references produtividade.projects(id) on update cascade on delete set null;

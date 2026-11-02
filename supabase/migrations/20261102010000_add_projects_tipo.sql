-- Projeto × processo, pela definição do PMI (PMBOK): PROJETO é um esforço
-- temporário, com início e fim, para criar um resultado único; PROCESSO (ou
-- operação) é contínuo e repetitivo, sem data para acabar. null = ainda não
-- classificado (o app trata como projeto). Quem classifica é a Kiê, na página
-- do projeto, ou o secretário agendado (docs/SECRETARIO.md §5c). Processos
-- continuam no Duelo e no score como qualquer projeto (decisão da Kiê).
alter table produtividade.projects
  add column tipo text check (tipo in ('projeto', 'processo'));

notify pgrst, 'reload schema';

-- Bug: apagar uma tarefa (ou projeto/nota/item de leitura/anotação) removia
-- a linha no banco, mas ela continuava visível na UI até o F5.
--
-- Causa: subscribeTable() (src/repositories/realtimeTable.ts) filtra o canal
-- Realtime por `user_id=eq.<uid>`. Com REPLICA IDENTITY DEFAULT (o padrão),
-- o Postgres só inclui as colunas da chave primária (`id`) no registro "old"
-- enviado ao WAL para eventos DELETE — `user_id` não está lá. Sem essa
-- coluna, o Supabase Realtime não consegue avaliar o filtro e descarta o
-- evento DELETE silenciosamente, então o estado local (`rows` em
-- realtimeTable.ts) nunca remove a linha apagada.
--
-- Fix: REPLICA IDENTITY FULL faz o Postgres incluir todas as colunas no
-- registro "old", permitindo que o filtro por user_id funcione também em
-- DELETE (e em UPDATE de colunas fora da chave primária).
alter table public.tasks          replica identity full;
alter table public.projects       replica identity full;
alter table public.notes          replica identity full;
alter table public.reading_items  replica identity full;
alter table public.annotations    replica identity full;
alter table public.project_ratings replica identity full;

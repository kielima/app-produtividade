-- Espelho, gravado pelo app, do último score calculado por
-- calcScore/calcScoreBreakdown (src/lib/score.ts). O cálculo em si continua
-- só em memória no cliente (depende de dependências entre tarefas, ordem
-- dos projetos e da data corrente) — estas colunas guardam o resultado mais
-- recente para consumo fora do app, sem precisar recalcular a fórmula
-- (ex.: a skill de bom dia, que consulta o Supabase direto por SQL).
--
-- `score_breakdown` guarda o objeto `ScoreBreakdown` inteiro (rankScore,
-- moscowPts, deadlineBonus, ageBonus, depBonus etc.) pra permitir explicar o
-- "porquê" do score sem recalcular nada.
alter table produtividade.tasks
  add column score numeric,
  add column score_breakdown jsonb,
  add column score_updated_at timestamptz;

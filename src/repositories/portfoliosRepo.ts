import { supabase } from '../lib/supabase';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { Portfolio } from '../types';

interface PortfolioRow {
  id: string;
  user_id: string;
  nome: string;
  objetivo: string | null;
  ordem: number | null;
  gestao: string | null;
  gestao_atualizada_em: string | null;
}

function rowToPortfolio(row: PortfolioRow): Portfolio {
  return {
    id: row.id,
    nome: row.nome ?? '',
    objetivo: row.objetivo ?? '',
    ordem: row.ordem ?? null,
    gestao: row.gestao ?? '',
    gestaoAtualizadaEm: row.gestao_atualizada_em ?? null,
  };
}

export function subscribeToPortfolios(
  uid: string,
  cb: (portfolios: Portfolio[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<PortfolioRow, Portfolio>(
    { table: 'portfolios', uid, mapRow: rowToPortfolio, idOf: (p) => p.id, onError },
    (list) =>
      cb(
        [...list].sort(
          (a, b) =>
            (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) ||
            a.nome.localeCompare(b.nome, 'pt-BR'),
        ),
      ),
  );
}

export async function createPortfolio(
  uid: string,
  input: { nome: string; objetivo: string; ordem?: number | null },
): Promise<void> {
  const nome = input.nome.trim();
  if (!nome) throw new Error('O portfólio precisa de um nome.');
  const { data, error } = await supabase
    .from('portfolios')
    .insert({ user_id: uid, nome, objetivo: input.objetivo.trim(), ordem: input.ordem ?? null })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  publishLocalRow('portfolios', uid, data);
}

export async function updatePortfolio(
  uid: string,
  id: string,
  input: { nome: string; objetivo: string },
): Promise<void> {
  const nome = input.nome.trim();
  if (!nome) throw new Error('O portfólio precisa de um nome.');
  const { data, error } = await supabase
    .from('portfolios')
    .update({ nome, objetivo: input.objetivo.trim() })
    .eq('user_id', uid)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  publishLocalRow('portfolios', uid, data);
}

export async function deletePortfolio(uid: string, id: string): Promise<void> {
  // Os projetos ficam sem portfólio (`on delete set null`), não são apagados.
  const { error } = await supabase.from('portfolios').delete().eq('user_id', uid).eq('id', id);
  if (error) throw new Error(error.message);
}

import { supabase } from '../lib/supabase';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { ThreadComment } from '../types';

/**
 * Onde moram os comentários de cada tipo de alvo. Notas e projetos têm a
 * mesma forma de comentário (só texto, autor, quando); só mudam a tabela e a
 * coluna que aponta para o alvo. Tarefas têm repositório próprio
 * (taskCommentsRepo.ts) por causa da contagem no card.
 */
export const ALVOS = {
  nota: { table: 'note_comments', column: 'note_id' },
  projeto: { table: 'project_comments', column: 'project_id' },
} as const;

export type TipoDeAlvo = keyof typeof ALVOS;

type Row = {
  id: string;
  user_id: string;
  texto: string;
  autor_nome: string | null;
  autor_email: string | null;
  criado_em: string;
} & Record<string, unknown>;

function mapper(tipo: TipoDeAlvo) {
  const { column } = ALVOS[tipo];
  return (row: Row): ThreadComment => ({
    id: row.id,
    alvoId: String(row[column]),
    texto: row.texto,
    autorNome: row.autor_nome,
    autorEmail: row.autor_email,
    criadoEm: row.criado_em,
  });
}

/** Comentários de UM alvo (nota ou projeto), em ordem de criação. */
export function subscribeToThread(
  tipo: TipoDeAlvo,
  uid: string,
  alvoId: string,
  cb: (comments: ThreadComment[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const { table, column } = ALVOS[tipo];
  return subscribeTable<Row, ThreadComment>(
    {
      table,
      uid,
      extraColumn: column,
      extraValue: alvoId,
      mapRow: mapper(tipo),
      idOf: (c) => c.id,
      onError,
    },
    (list) => cb([...list].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))),
  );
}

export async function addThreadComment(
  tipo: TipoDeAlvo,
  uid: string,
  alvoId: string,
  texto: string,
  autor: { nome: string | null; email: string | null },
): Promise<void> {
  const { table, column } = ALVOS[tipo];
  const corpo = texto.trim();
  if (!corpo) throw new Error('O comentário não pode ficar vazio.');
  const { data, error } = await supabase
    .from(table)
    .insert({
      user_id: uid,
      [column]: alvoId,
      texto: corpo.slice(0, 4000),
      autor_nome: autor.nome,
      autor_email: autor.email,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  publishLocalRow(table, alvoId, data);
}

export async function deleteThreadComment(tipo: TipoDeAlvo, uid: string, id: string): Promise<void> {
  const { error } = await supabase.from(ALVOS[tipo].table).delete().eq('user_id', uid).eq('id', id);
  if (error) throw new Error(error.message);
}

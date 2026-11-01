import { supabase } from '../lib/supabase';
import { idsAguardandoResposta, type ComentarioResumo } from '../lib/aguardaResposta';

export type Unsubscribe = () => void;

export interface CommentSummary {
  // Quantos comentários cada alvo (tarefa ou nota) tem. Sem comentário = fora.
  counts: Record<string, number>;
  // Alvos cujo último comentário é do Claude (ver aguardaResposta.ts).
  aguardando: Set<string>;
}

interface Row {
  id: string;
  alvo: string;
  autor_nome: string | null;
  criado_em: string;
}

/**
 * Assina um RESUMO dos comentários de uma tabela (`task_comments` ou
 * `note_comments`): contagem e quem está esperando resposta — sem baixar o
 * texto. Usado pelo selinho 💬 do card e pelo filtro "esperando minha
 * resposta".
 */
export function subscribeToCommentSummary(
  table: 'task_comments' | 'note_comments',
  targetColumn: 'task_id' | 'note_id',
  uid: string,
  cb: (summary: CommentSummary) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let cancelled = false;
  const rows = new Map<string, Row>();

  function emit() {
    if (cancelled) return;
    const counts: Record<string, number> = {};
    const porAlvo = new Map<string, ComentarioResumo[]>();
    for (const r of rows.values()) {
      counts[r.alvo] = (counts[r.alvo] ?? 0) + 1;
      const lista = porAlvo.get(r.alvo) ?? [];
      lista.push({ autorNome: r.autor_nome, criadoEm: r.criado_em });
      porAlvo.set(r.alvo, lista);
    }
    cb({ counts, aguardando: idsAguardandoResposta(porAlvo) });
  }

  function fromRaw(raw: Record<string, unknown>): Row {
    return {
      id: String(raw.id),
      alvo: String(raw[targetColumn]),
      autor_nome: (raw.autor_nome as string | null) ?? null,
      criado_em: String(raw.criado_em ?? ''),
    };
  }

  void supabase
    .from(table)
    .select(`id, ${targetColumn}, autor_nome, criado_em`)
    .eq('user_id', uid)
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        onError?.(new Error(error.message));
        return;
      }
      rows.clear();
      for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
        const r = fromRaw(raw);
        rows.set(r.id, r);
      }
      emit();
    });

  const channel = supabase
    .channel(`rt:${table}_summary:${uid}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'produtividade', table, filter: `user_id=eq.${uid}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Record<string, unknown>;
          if (typeof old.id === 'string') rows.delete(old.id);
        } else {
          const r = fromRaw(payload.new as Record<string, unknown>);
          rows.set(r.id, r);
        }
        emit();
      },
    )
    .subscribe();

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}

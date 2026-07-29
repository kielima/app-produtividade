import { supabase } from '../lib/supabase';

export type Unsubscribe = () => void;

interface SubscribeTableOptions<TRow, T> {
  table: string;
  uid: string;
  // Escopo adicional além de user_id (ex.: annotations filtradas por
  // reading_item_id). RLS já garante o isolamento por usuário no Postgres,
  // então um único filtro extra é suficiente e seguro.
  extraColumn?: string;
  extraValue?: string;
  // Coluna que identifica a linha no evento DELETE do Realtime (a maioria
  // das tabelas usa `id`; project_ratings usa `project_id`, sem PK própria).
  rowIdColumn?: string;
  mapRow: (row: TRow) => T;
  idOf: (item: T) => string;
  onError?: (err: Error) => void;
}

/**
 * Substitui o padrão `onSnapshot` do Firestore: busca o estado inicial via
 * REST e mantém um mapa em memória atualizado por eventos do Realtime
 * (INSERT/UPDATE/DELETE linha-a-linha, ao contrário do snapshot completo do
 * Firestore) — cada evento reemite a lista inteira via `cb`.
 */
export function subscribeTable<TRow, T>(
  opts: SubscribeTableOptions<TRow, T>,
  cb: (items: T[]) => void,
): Unsubscribe {
  const { table, uid, extraColumn, extraValue, rowIdColumn = 'id', mapRow, idOf, onError } = opts;
  let cancelled = false;
  const rows = new Map<string, T>();

  function emit() {
    if (!cancelled) cb(Array.from(rows.values()));
  }

  const initialQuery = supabase.from(table).select('*').eq('user_id', uid);
  const scopedQuery =
    extraColumn && extraValue !== undefined ? initialQuery.eq(extraColumn, extraValue) : initialQuery;

  void scopedQuery.then(({ data, error }) => {
    if (cancelled) return;
    if (error) {
      onError?.(new Error(error.message));
      return;
    }
    rows.clear();
    for (const row of (data ?? []) as TRow[]) {
      const item = mapRow(row);
      rows.set(idOf(item), item);
    }
    emit();
  });

  const filter =
    extraColumn && extraValue !== undefined ? `${extraColumn}=eq.${extraValue}` : `user_id=eq.${uid}`;

  const channel = supabase
    .channel(`rt:${table}:${extraValue ?? uid}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Record<string, unknown>;
          const key = old[rowIdColumn];
          if (typeof key === 'string') rows.delete(key);
        } else {
          const item = mapRow(payload.new as TRow);
          rows.set(idOf(item), item);
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

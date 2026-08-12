import { supabase } from '../lib/supabase';

export type Unsubscribe = () => void;

type LocalRowListener = (row: unknown) => void;

// Assinaturas vivas indexadas por tabela+escopo, para que uma escrita local
// possa aplicar a linha no cache da assinatura sem esperar o Realtime.
const localListeners = new Map<string, Set<LocalRowListener>>();

function scopeKey(table: string, scope: string): string {
  return `${table}:${scope}`;
}

/**
 * Ecoa uma linha recém-gravada nas assinaturas ativas da tabela, aplicando-a
 * já no cache local. O evento do Realtime chega logo depois com a versão
 * autoritativa e sobrescreve esta — o eco só cobre a janela (dezenas a
 * centenas de ms, ou indefinida se o websocket estiver caído) entre o
 * insert/update responder e o evento ser entregue.
 *
 * Sem isto, quem grava e navega para a linha em seguida (criar tarefa → abrir
 * a tela da tarefa) aponta para um id que ainda não existe no estado local.
 *
 * `scope` é o mesmo usado na assinatura: `extraValue` quando a tabela é
 * filtrada por outra coluna, senão o uid.
 */
export function publishLocalRow(table: string, scope: string, row: unknown): void {
  const listeners = localListeners.get(scopeKey(table, scope));
  if (!listeners) return;
  for (const listener of [...listeners]) listener(row);
}

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

  // Linhas ecoadas por escritas locais enquanto a busca inicial está em voo:
  // podem não estar no resultado dela, então são reaplicadas por cima.
  const echoedBeforeLoad = new Map<string, T>();
  let initialLoaded = false;

  function applyLocalRow(row: unknown) {
    if (cancelled) return;
    const item = mapRow(row as TRow);
    rows.set(idOf(item), item);
    if (!initialLoaded) echoedBeforeLoad.set(idOf(item), item);
    emit();
  }

  const key = scopeKey(table, extraValue ?? uid);
  let listeners = localListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    localListeners.set(key, listeners);
  }
  listeners.add(applyLocalRow);

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
    for (const [id, item] of echoedBeforeLoad) rows.set(id, item);
    echoedBeforeLoad.clear();
    initialLoaded = true;
    emit();
  });

  const filter =
    extraColumn && extraValue !== undefined ? `${extraColumn}=eq.${extraValue}` : `user_id=eq.${uid}`;

  const channel = supabase
    .channel(`rt:${table}:${extraValue ?? uid}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      // Schema `produtividade`: o projeto é compartilhado com a wishlist e as
      // tabelas deste app saíram do `public` — ver src/lib/supabase.ts. O
      // canal de realtime não herda o schema do createClient, por isso é
      // explícito aqui.
      { event: '*', schema: 'produtividade', table, filter },
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
    listeners.delete(applyLocalRow);
    if (listeners.size === 0) localListeners.delete(key);
    void supabase.removeChannel(channel);
  };
}

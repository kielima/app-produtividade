// Checkpoint de sincronização do Drive: a lista de PDFs pode passar de 5 mil
// arquivos, então uma sincronização inteira demora. Se o app for minimizado e
// o SO suspender/matar o WebView no meio do processo, todo o progresso em
// memória se perde e a próxima sincronização reprocessava tudo de novo. Aqui
// persistimos os IDs de arquivo já sincronizados para que ela retome do ponto
// onde parou em vez de começar do zero.
const CHECKPOINT_PREFIX = 'app-produtividade:drive-sync-checkpoint:';

function storageKey(uid: string): string {
  return `${CHECKPOINT_PREFIX}${uid}`;
}

export function loadSyncCheckpoint(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function saveSyncCheckpoint(uid: string, doneIds: Set<string>): void {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify([...doneIds]));
  } catch {
    // sem espaço / modo privado — segue sem checkpoint
  }
}

export function clearSyncCheckpoint(uid: string): void {
  try {
    localStorage.removeItem(storageKey(uid));
  } catch {
    // ignore
  }
}

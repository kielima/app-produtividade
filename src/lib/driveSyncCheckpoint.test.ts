import { beforeEach, describe, expect, it } from 'vitest';

// Ambiente de teste roda em 'node' (sem DOM), então localStorage não existe
// globalmente — replica um stub mínimo, mesma interface que o módulo usa.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { loadSyncCheckpoint, saveSyncCheckpoint, clearSyncCheckpoint } = await import(
  './driveSyncCheckpoint'
);

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe('driveSyncCheckpoint', () => {
  it('retorna conjunto vazio quando não há checkpoint salvo', () => {
    expect(loadSyncCheckpoint('u1')).toEqual(new Set());
  });

  it('salva e recarrega os IDs já sincronizados', () => {
    saveSyncCheckpoint('u1', new Set(['a', 'b', 'c']));
    expect(loadSyncCheckpoint('u1')).toEqual(new Set(['a', 'b', 'c']));
  });

  it('mantém checkpoints de usuários diferentes isolados', () => {
    saveSyncCheckpoint('u1', new Set(['a']));
    saveSyncCheckpoint('u2', new Set(['b']));
    expect(loadSyncCheckpoint('u1')).toEqual(new Set(['a']));
    expect(loadSyncCheckpoint('u2')).toEqual(new Set(['b']));
  });

  it('limpa o checkpoint', () => {
    saveSyncCheckpoint('u1', new Set(['a']));
    clearSyncCheckpoint('u1');
    expect(loadSyncCheckpoint('u1')).toEqual(new Set());
  });

  it('ignora JSON corrompido em vez de quebrar', () => {
    localStorage.setItem('app-produtividade:drive-sync-checkpoint:u1', '{not json');
    expect(loadSyncCheckpoint('u1')).toEqual(new Set());
  });
});

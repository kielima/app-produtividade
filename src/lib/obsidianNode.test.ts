import { describe, expect, it } from 'vitest';
import { isOrphanTopLevelFolder } from './obsidianNode';

describe('isOrphanTopLevelFolder', () => {
  it('considera órfã uma pasta sem parents', () => {
    expect(isOrphanTopLevelFolder({ id: 'f1' }, 'root')).toBe(true);
  });

  it('considera órfã uma pasta com parents vazio', () => {
    expect(isOrphanTopLevelFolder({ id: 'f1', parents: [] }, 'root')).toBe(true);
  });

  it('não considera órfã uma pasta com pai normal', () => {
    expect(isOrphanTopLevelFolder({ id: 'f1', parents: ['root'] }, 'root')).toBe(false);
  });

  it('nunca considera a própria raiz órfã', () => {
    expect(isOrphanTopLevelFolder({ id: 'root' }, 'root')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { hasConflict } from './obsidianConflict';

describe('hasConflict', () => {
  it('não é conflito quando o modifiedTime não mudou', () => {
    expect(hasConflict('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z')).toBe(false);
  });

  it('é conflito quando o modifiedTime remoto mudou', () => {
    expect(hasConflict('2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z')).toBe(true);
  });
});

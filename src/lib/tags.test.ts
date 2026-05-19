import { describe, expect, it } from 'vitest';
import { normalizeTag, normalizeTags, parseTagsInput } from './tags';

describe('normalizeTag', () => {
  it('trims, lowercases and collapses spaces', () => {
    expect(normalizeTag('  Foo   Bar  ')).toBe('foo bar');
  });

  it('returns empty for blank input', () => {
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag('')).toBe('');
  });
});

describe('normalizeTags', () => {
  it('removes blanks and dedupes case-insensitively, preserving order', () => {
    expect(normalizeTags(['Work', 'work', '', '  ', 'Urgent', 'URGENT'])).toEqual([
      'work',
      'urgent',
    ]);
  });
});

describe('parseTagsInput', () => {
  it('splits on commas and semicolons', () => {
    expect(parseTagsInput('alpha, beta; gamma, alpha')).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('returns empty array for blank input', () => {
    expect(parseTagsInput('  ,  ; ')).toEqual([]);
  });
});

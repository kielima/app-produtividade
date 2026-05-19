import { describe, expect, it } from 'vitest';
import { hasLink, normalizeTag, normalizeTags, parseTagsInput } from './tags';

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

describe('hasLink', () => {
  it('detects raw https/http URLs', () => {
    expect(hasLink('veja https://example.com/foo')).toBe(true);
    expect(hasLink('http://example.com')).toBe(true);
  });

  it('detects www URLs without protocol', () => {
    expect(hasLink('www.example.com tem isso')).toBe(true);
  });

  it('detects URLs dentro de links Markdown', () => {
    expect(hasLink('texto [exemplo](https://example.com) aqui')).toBe(true);
  });

  it('retorna false quando não há link', () => {
    expect(hasLink('apenas texto comum')).toBe(false);
    expect(hasLink('')).toBe(false);
    expect(hasLink('algo.com sem prefixo')).toBe(false);
  });
});

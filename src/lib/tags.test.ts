import { describe, expect, it } from 'vitest';
import { hasLink, hasList, normalizeTag, normalizeTags, parseTagsInput } from './tags';

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

describe('hasList', () => {
  it('retorna true quando há items', () => {
    expect(hasList([{ text: 'a', checked: false }], '')).toBe(true);
  });

  it('detecta lista com bullets em markdown', () => {
    expect(hasList([], '- comprar leite\n- pegar pão')).toBe(true);
    expect(hasList([], 'intro\n\n* item a\n* item b')).toBe(true);
    expect(hasList([], '+ item único')).toBe(true);
  });

  it('detecta lista numerada em markdown', () => {
    expect(hasList([], '1. primeiro\n2. segundo')).toBe(true);
  });

  it('detecta checklist em markdown', () => {
    expect(hasList([], '- [ ] fazer x\n- [x] feito y')).toBe(true);
  });

  it('retorna false sem items e sem lista no texto', () => {
    expect(hasList([], 'apenas texto comum')).toBe(false);
    expect(hasList([], '')).toBe(false);
    expect(hasList([], '- ')).toBe(false); // bullet sem conteúdo
    expect(hasList([], '1.sem espaço')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeForSearch } from './searchNormalize';

describe('normalizeForSearch', () => {
  it('lowercases the string', () => {
    expect(normalizeForSearch('Agencia')).toBe('agencia');
    expect(normalizeForSearch('AGENCIA')).toBe('agencia');
  });

  it('strips Portuguese diacritics', () => {
    expect(normalizeForSearch('Agência')).toBe('agencia');
    expect(normalizeForSearch('AÇÃO')).toBe('acao');
    expect(normalizeForSearch('coração')).toBe('coracao');
    expect(normalizeForSearch('Açaí')).toBe('acai');
    expect(normalizeForSearch('Ônibus')).toBe('onibus');
    expect(normalizeForSearch('pôr')).toBe('por');
    expect(normalizeForSearch('über')).toBe('uber');
  });

  it('makes accented and unaccented forms equal', () => {
    expect(normalizeForSearch('Agência')).toBe(normalizeForSearch('agencia'));
    expect(normalizeForSearch('Não')).toBe(normalizeForSearch('nao'));
  });

  it('handles empty strings', () => {
    expect(normalizeForSearch('')).toBe('');
  });

  it('keeps non-letter characters intact', () => {
    expect(normalizeForSearch('Olá, mundo! #1')).toBe('ola, mundo! #1');
  });
});

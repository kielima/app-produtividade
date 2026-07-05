import { describe, expect, it } from 'vitest';
import type { ReadingItem } from '../types';
import {
  groupIntoShelves,
  readingTypeFromInput,
  readingTypeLabel,
  sortReadingTypes,
} from './readingTypes';

function item(id: string, itemType: string): ReadingItem {
  return {
    id,
    driveFileId: id,
    format: 'pdf',
    title: id,
    authors: [],
    itemType,
    tags: [],
    addedDate: '2026-01-01',
    readingStatus: 'to-read',
  };
}

describe('readingTypeLabel', () => {
  it('traduz os tipos embutidos', () => {
    expect(readingTypeLabel('article')).toBe('Artigo');
    expect(readingTypeLabel('book')).toBe('Livro');
    expect(readingTypeLabel('other')).toBe('Outro');
  });

  it('devolve o próprio texto para tipos personalizados', () => {
    expect(readingTypeLabel('Tese')).toBe('Tese');
  });
});

describe('readingTypeFromInput', () => {
  it('mapeia rótulos de embutidos de volta para a chave', () => {
    expect(readingTypeFromInput('Artigo')).toBe('article');
    expect(readingTypeFromInput('livro')).toBe('book');
    expect(readingTypeFromInput('  Outro ')).toBe('other');
  });

  it('aceita a própria chave embutida', () => {
    expect(readingTypeFromInput('article')).toBe('article');
  });

  it('guarda texto personalizado como digitado (aparado)', () => {
    expect(readingTypeFromInput('  Tese de Doutorado ')).toBe('Tese de Doutorado');
  });

  it('cai em "other" quando vazio', () => {
    expect(readingTypeFromInput('   ')).toBe('other');
  });
});

describe('sortReadingTypes', () => {
  it('coloca embutidos na ordem canônica e personalizados depois por rótulo', () => {
    expect(sortReadingTypes(['Zeta', 'other', 'book', 'Alfa', 'article'])).toEqual([
      'article',
      'book',
      'other',
      'Alfa',
      'Zeta',
    ]);
  });
});

describe('groupIntoShelves', () => {
  it('agrupa por tipo, só devolve estantes com itens e ordena as estantes', () => {
    const shelves = groupIntoShelves([
      item('a', 'Tese'),
      item('b', 'article'),
      item('c', 'Tese'),
      item('d', 'book'),
    ]);
    expect(shelves.map((s) => s.type)).toEqual(['article', 'book', 'Tese']);
    expect(shelves.map((s) => s.label)).toEqual(['Artigo', 'Livro', 'Tese']);
    expect(shelves.find((s) => s.type === 'Tese')!.items.map((i) => i.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('trata itemType vazio como "other"', () => {
    const shelves = groupIntoShelves([item('a', '')]);
    expect(shelves).toHaveLength(1);
    expect(shelves[0].type).toBe('other');
  });
});

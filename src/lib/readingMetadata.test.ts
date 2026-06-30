import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractDoiFromText,
  fetchByDoi,
  fetchByIsbn,
  normalizeDoi,
  normalizeIssn,
} from './readingMetadata';

describe('normalizeDoi', () => {
  it('strips URL and doi: prefixes', () => {
    expect(normalizeDoi('https://doi.org/10.1000/xyz')).toBe('10.1000/xyz');
    expect(normalizeDoi('https://dx.doi.org/10.1000/xyz')).toBe('10.1000/xyz');
    expect(normalizeDoi('doi:10.1000/xyz')).toBe('10.1000/xyz');
    expect(normalizeDoi('  10.1000/xyz  ')).toBe('10.1000/xyz');
  });
});

describe('normalizeIssn', () => {
  it('inserts the hyphen for 8-digit input', () => {
    expect(normalizeIssn('15334406')).toBe('1533-4406');
    expect(normalizeIssn('1533-4406')).toBe('1533-4406');
  });
});

describe('extractDoiFromText', () => {
  it('finds a DOI inside arbitrary text', () => {
    expect(
      extractDoiFromText('Available at https://doi.org/10.1016/j.cell.2020.01.001 today.'),
    ).toBe('10.1016/j.cell.2020.01.001');
  });
  it('returns null when no DOI present', () => {
    expect(extractDoiFromText('no identifier here')).toBeNull();
  });
  it('trims trailing punctuation', () => {
    expect(extractDoiFromText('see 10.1000/abc.')).toBe('10.1000/abc');
  });
});

describe('fetchByDoi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps CrossRef fields into FetchedMetadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            title: ['A Great Paper'],
            author: [
              { given: 'Ada', family: 'Lovelace' },
              { given: 'Alan', family: 'Turing' },
            ],
            'container-title': ['Journal of Things'],
            ISSN: ['1234-5678'],
            type: 'journal-article',
            issued: { 'date-parts': [[2021, 4]] },
          },
        }),
      }),
    );
    const meta = await fetchByDoi('10.1/abc');
    expect(meta.title).toBe('A Great Paper');
    expect(meta.authors).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(meta.publication).toBe('Journal of Things');
    expect(meta.issn).toBe('1234-5678');
    expect(meta.year).toBe('2021');
    expect(meta.itemType).toBe('article');
  });

  it('throws a friendly error on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );
    await expect(fetchByDoi('10.1/missing')).rejects.toThrow(/não encontrado/i);
  });
});

describe('fetchByIsbn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps Google Books fields and marks it as a book', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          totalItems: 1,
          items: [
            {
              volumeInfo: {
                title: 'Clean Code',
                authors: ['Robert C. Martin'],
                publisher: 'Prentice Hall',
                publishedDate: '2008-08-01',
              },
            },
          ],
        }),
      }),
    );
    const meta = await fetchByIsbn('9780132350884');
    expect(meta.title).toBe('Clean Code');
    expect(meta.authors).toEqual(['Robert C. Martin']);
    expect(meta.publication).toBe('Prentice Hall');
    expect(meta.year).toBe('2008');
    expect(meta.itemType).toBe('book');
  });
});

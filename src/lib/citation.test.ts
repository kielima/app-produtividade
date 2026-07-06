import { describe, expect, it } from 'vitest';
import { formatAbntCitation } from './citation';
import type { ReadingItem } from '../types';

function makeItem(partial: Partial<ReadingItem>): ReadingItem {
  return {
    id: 'i1',
    driveFileId: 'f1',
    format: 'pdf',
    title: 'Título de exemplo',
    authors: [],
    itemType: 'article',
    tags: [],
    addedDate: '2024-01-01',
    readingStatus: 'reading',
    ...partial,
  };
}

describe('formatAbntCitation', () => {
  it('formats a single author', () => {
    const item = makeItem({ authors: ['Naoki Aihara'], year: '2010' });
    expect(formatAbntCitation(item, 1)).toBe('(AIHARA, 2010, p.1)');
  });

  it('formats two authors separated by semicolon', () => {
    const item = makeItem({ authors: ['Naoki Aihara', 'Taro Tsujimura'], year: '2010' });
    expect(formatAbntCitation(item, 3)).toBe('(AIHARA; TSUJIMURA, 2010, p.3)');
  });

  it('uses "et al." for three or more authors', () => {
    const item = makeItem({
      authors: ['Naoki Aihara', 'Taro Tsujimura', 'Someone Else'],
      year: '2010',
    });
    expect(formatAbntCitation(item, 5)).toBe('(AIHARA et al., 2010, p.5)');
  });

  it('falls back to the item title when there are no authors', () => {
    const item = makeItem({ authors: [], year: '2021' });
    expect(formatAbntCitation(item, 2)).toBe('(Título de exemplo, 2021, p.2)');
  });

  it('falls back to "s.d." when there is no year', () => {
    const item = makeItem({ authors: ['Naoki Aihara'], year: undefined });
    expect(formatAbntCitation(item, 1)).toBe('(AIHARA, s.d., p.1)');
  });
});

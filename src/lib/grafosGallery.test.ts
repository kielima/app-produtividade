import { describe, expect, it } from 'vitest';
import {
  allTagsFrom,
  filterImagesByTags,
  groupImagesByMonth,
  onlyImages,
  parseTags,
  serializeTags,
  TAGS_PROPERTY_KEY,
} from './grafosGallery';
import type { DriveNode } from './grafosNode';

function image(overrides: Partial<DriveNode>): DriveNode {
  return {
    id: 'id',
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    isFolder: false,
    ...overrides,
  };
}

describe('parseTags / serializeTags', () => {
  it('lê tags de properties, ignorando espaços e vazios', () => {
    expect(parseTags({ [TAGS_PROPERTY_KEY]: 'praia, verão,, família ' })).toEqual([
      'praia',
      'verão',
      'família',
    ]);
  });

  it('devolve lista vazia sem properties ou sem a chave', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags({})).toEqual([]);
  });

  it('serializa removendo duplicatas e espaços', () => {
    expect(serializeTags(['praia', ' praia ', 'verão'])).toBe('praia,verão');
  });
});

describe('groupImagesByMonth', () => {
  it('agrupa por mês, mais recente primeiro, imagens sem data por último', () => {
    const images = [
      image({ id: '1', modifiedTime: '2026-01-05T10:00:00Z' }),
      image({ id: '2', modifiedTime: '2026-03-20T10:00:00Z' }),
      image({ id: '3', modifiedTime: '2026-01-20T10:00:00Z' }),
      image({ id: '4' }),
    ];
    const groups = groupImagesByMonth(images);
    expect(groups.map((g) => g.key)).toEqual(['2026-03', '2026-01', '']);
    expect(groups[1].images.map((i) => i.id)).toEqual(['3', '1']);
    expect(groups[2].label).toBe('Sem data');
  });
});

describe('allTagsFrom / filterImagesByTags', () => {
  const images = [
    image({ id: '1', properties: { [TAGS_PROPERTY_KEY]: 'praia,verão' } }),
    image({ id: '2', properties: { [TAGS_PROPERTY_KEY]: 'praia' } }),
    image({ id: '3' }),
  ];

  it('coleta todas as tags únicas em ordem alfabética', () => {
    expect(allTagsFrom(images)).toEqual(['praia', 'verão']);
  });

  it('sem tags selecionadas devolve tudo', () => {
    expect(filterImagesByTags(images, [])).toHaveLength(3);
  });

  it('filtra por AND entre as tags selecionadas', () => {
    expect(filterImagesByTags(images, ['praia']).map((i) => i.id)).toEqual(['1', '2']);
    expect(filterImagesByTags(images, ['praia', 'verão']).map((i) => i.id)).toEqual(['1']);
  });
});

describe('onlyImages', () => {
  it('mantém só arquivos de imagem, descartando pastas e outros tipos', () => {
    const nodes: DriveNode[] = [
      image({ id: '1' }),
      { id: '2', name: 'pasta', mimeType: 'application/vnd.google-apps.folder', isFolder: true },
      { id: '3', name: 'nota.md', mimeType: 'text/markdown', isFolder: false },
    ];
    expect(onlyImages(nodes).map((n) => n.id)).toEqual(['1']);
  });
});

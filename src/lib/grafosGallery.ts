// Lógica pura da aba Galeria (spec da tarefa #949: galeria com tags e
// timeline no Files/Grafos) — sem chamada de rede, testável isolado (mesmo
// padrão de grafosNode.ts/grafosTreeState.ts). As tags de uma imagem vivem
// nas `properties` (metadado custom) do próprio arquivo no Drive, como uma
// string separada por vírgulas sob TAGS_PROPERTY_KEY — não há tabela nova no
// Supabase, o Drive já é a fonte de verdade de todo o vault (ver
// grafosDrive.ts).

import { isImageFile, type DriveNode } from './grafosNode';

export const TAGS_PROPERTY_KEY = 'tags';

export function parseTags(properties: Record<string, string> | undefined): string[] {
  const raw = properties?.[TAGS_PROPERTY_KEY];
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function serializeTags(tags: string[]): string {
  const unique = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  return unique.join(',');
}

export type GalleryGroup = {
  key: string; // "YYYY-MM", vazio para imagens sem modifiedTime
  label: string;
  images: DriveNode[];
};

const MONTH_FORMATTER = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

function monthKeyAndLabel(modifiedTime: string | undefined): { key: string; label: string } {
  if (!modifiedTime) return { key: '', label: 'Sem data' };
  const date = new Date(modifiedTime);
  if (Number.isNaN(date.getTime())) return { key: '', label: 'Sem data' };
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const label = MONTH_FORMATTER.format(date);
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

// Agrupa por mês de modificação (spec: timeline), grupos mais recentes
// primeiro, imagens dentro de cada grupo também mais recentes primeiro.
export function groupImagesByMonth(images: DriveNode[]): GalleryGroup[] {
  const groups = new Map<string, GalleryGroup>();
  for (const image of images) {
    const { key, label } = monthKeyAndLabel(image.modifiedTime);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, images: [] };
      groups.set(key, group);
    }
    group.images.push(image);
  }
  for (const group of groups.values()) {
    group.images.sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
  }
  // "Sem data" (key vazia) sempre por último, o resto em ordem decrescente.
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === '') return 1;
    if (b.key === '') return -1;
    return b.key.localeCompare(a.key);
  });
}

export function allTagsFrom(images: DriveNode[]): string[] {
  const tags = new Set<string>();
  for (const image of images) {
    for (const tag of parseTags(image.properties)) tags.add(tag);
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Semântica AND: uma imagem só passa se tiver TODAS as tags selecionadas —
// filtro que estreita os resultados a cada tag marcada, igual a maioria dos
// apps de galeria com múltiplos filtros ativos ao mesmo tempo.
export function filterImagesByTags(images: DriveNode[], selectedTags: string[]): DriveNode[] {
  if (selectedTags.length === 0) return images;
  return images.filter((image) => {
    const imageTags = new Set(parseTags(image.properties));
    return selectedTags.every((tag) => imageTags.has(tag));
  });
}

export function onlyImages(nodes: DriveNode[]): DriveNode[] {
  return nodes.filter((n) => !n.isFolder && isImageFile(n));
}

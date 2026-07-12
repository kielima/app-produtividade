import type { Annotation, ReadingItem } from '../types';
import { formatAbntCitation } from './citation';

// Formata o texto realçado como citação em bloco markdown (cada linha
// prefixada com "> "), reutilizado tanto pela pré-visualização no editor
// quanto pelo corpo da nota/tarefa criada a partir da anotação.
export function quoteMarkdown(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

// Monta título e corpo (markdown) ao converter uma anotação em nota/tarefa:
// citação em bloco + comentário do usuário + referência ABNT. Compartilhado
// pelos leitores de PDF e EPUB.
export function composeAnnotationConversion(
  item: ReadingItem,
  annotation: Annotation,
  commentTitle: string,
  commentText: string,
): { title: string; body: string } {
  const headline = item.title ? `${item.title} (p.${annotation.page})` : `p.${annotation.page}`;
  const title = commentTitle.trim() || annotation.title?.trim() || headline;
  const cite = annotation.text ? quoteMarkdown(annotation.text) : '';
  const citation = formatAbntCitation(item, annotation.page);
  const body = [cite, commentText.trim(), citation].filter(Boolean).join('\n\n');
  return { title, body };
}

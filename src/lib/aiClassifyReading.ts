// Classifica automaticamente um item da estante de leitura (artigo/livro/
// outro) com base no conteúdo das primeiras páginas do PDF, via Claude (ver
// `claudeClient.ts`). Não depende de DOI: tenta o texto extraído primeiro; se
// vier curto demais (PDF escaneado sem camada de texto), manda a imagem da 1ª
// página para o Claude analisar visualmente — mesmo padrão de
// `aiTranscribe.ts`.

import type { PDFDocumentProxy } from './pdf';
import { callClaude, imagePart, type ClaudePart } from './claudeClient';

export class AiClassifyError extends Error {}

export interface ClassifyResult {
  itemType: 'article' | 'book' | 'other';
}

// Abaixo disso, o texto extraído provavelmente não reflete o conteúdo real
// (PDF escaneado/imagem sem camada de texto) — cai para análise visual.
const MIN_TEXT_LENGTH = 200;
const MAX_TEXT_CHARS = 6000;

async function extractFirstPagesText(
  doc: PDFDocumentProxy,
  maxPages: number,
): Promise<string> {
  const pageCount = Math.min(doc.numPages, maxPages);
  const texts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return texts.join('\n\n').trim();
}

async function renderPageToImage(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ imageBase64: string; mimeType: string }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AiClassifyError('Canvas indisponível.');
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  return { imageBase64: dataUrl.split(',')[1] ?? '', mimeType: 'image/png' };
}

const PROMPT = [
  'Você é um bibliotecário. Com base no conteúdo a seguir (texto extraído ou',
  'imagem das primeiras páginas de um PDF), classifique o documento em UM',
  'destes tipos:',
  '- "article": artigo científico/acadêmico, paper, capítulo curto de revista;',
  '- "book": livro, e-book, manual ou apostila longa;',
  '- "other": qualquer outra coisa (slides, relatório, contrato, formulário, etc.).',
].join('\n');

export async function classifyReadingItem(
  doc: PDFDocumentProxy,
): Promise<ClassifyResult> {
  const text = await extractFirstPagesText(doc, 3);
  const parts: ClaudePart[] = [];
  if (text.length < MIN_TEXT_LENGTH) {
    const { imageBase64, mimeType } = await renderPageToImage(doc, 1);
    parts.push(await imagePart(imageBase64, mimeType));
  }
  parts.push({
    type: 'text',
    text: text ? `${PROMPT}\n\n## Texto extraído\n${text.slice(0, MAX_TEXT_CHARS)}` : PROMPT,
  });

  let parsed: { itemType?: unknown };
  try {
    parsed = await callClaude<{ itemType?: unknown }>({
      content: parts,
      maxTokens: 1024,
      schema: {
        type: 'object',
        properties: { itemType: { type: 'string', enum: ['article', 'book', 'other'] } },
        required: ['itemType'],
        additionalProperties: false,
      },
    });
  } catch (e) {
    throw new AiClassifyError(e instanceof Error ? e.message : String(e));
  }

  const itemType = parsed.itemType;
  if (itemType !== 'article' && itemType !== 'book' && itemType !== 'other') {
    throw new AiClassifyError('Tipo classificado inválido.');
  }
  return { itemType };
}

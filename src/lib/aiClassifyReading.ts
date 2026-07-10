// Classifica automaticamente um item da estante de leitura (artigo/livro/
// outro) com base no conteúdo das primeiras páginas do PDF, via Gemini
// (mesma chave/modelo configurados em `aiSubtasks.ts`). Não depende de DOI:
// tenta o texto extraído primeiro; se vier curto demais (PDF escaneado sem
// camada de texto), manda a imagem da 1ª página para o Gemini analisar
// visualmente — mesmo padrão de `aiTranscribe.ts`.

import type { PDFDocumentProxy } from './pdf';
import { getGeminiApiKey, getGeminiModel } from './aiSubtasks';

export class AiClassifyError extends Error {}
// Erro específico para "sem chave configurada" — o chamador pode usá-lo para
// não marcar o item como "já tentado" e assim classificar automaticamente
// assim que o usuário configurar a chave, sem exigir reclassificação manual.
export class MissingApiKeyError extends AiClassifyError {}

export interface ClassifyResult {
  itemType: 'article' | 'book' | 'other';
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
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
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new MissingApiKeyError('Chave Gemini não configurada.');
  }

  const text = await extractFirstPagesText(doc, 3);
  const parts: Array<Record<string, unknown>> = [];
  if (text.length < MIN_TEXT_LENGTH) {
    const { imageBase64, mimeType } = await renderPageToImage(doc, 1);
    parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
  }
  parts.push({
    text: text
      ? `${PROMPT}\n\n## Texto extraído\n${text.slice(0, MAX_TEXT_CHARS)}`
      : PROMPT,
  });

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          itemType: { type: 'string', enum: ['article', 'book', 'other'] },
        },
        required: ['itemType'],
      },
    },
  };

  const model = getGeminiModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let res: Response;
  try {
    res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AiClassifyError(
      `Falha de rede ao chamar Gemini: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const json = (await res.json().catch(() => null)) as GeminiResponse | null;

  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new AiClassifyError(`Gemini respondeu erro: ${msg}`);
  }
  if (!json) {
    throw new AiClassifyError('Resposta vazia do Gemini.');
  }
  if (json.promptFeedback?.blockReason) {
    throw new AiClassifyError(`Prompt bloqueado: ${json.promptFeedback.blockReason}`);
  }

  const responseText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new AiClassifyError('Resposta do Gemini sem conteúdo.');
  }

  let parsed: { itemType?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new AiClassifyError('JSON inválido na resposta do Gemini.');
  }

  const itemType = parsed.itemType;
  if (itemType !== 'article' && itemType !== 'book' && itemType !== 'other') {
    throw new AiClassifyError('Tipo classificado inválido.');
  }
  return { itemType };
}

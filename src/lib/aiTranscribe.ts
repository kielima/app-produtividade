// Extrai texto de uma imagem (compartilhada de outro app ou desenhada à mão)
// via Claude — ver src/lib/claudeClient.ts.

import { callClaude, imagePart } from './claudeClient';

export class AiTranscribeError extends Error {}

export interface TranscribedContent {
  title: string;
  text: string;
}

const PROMPT = [
  'Você é um assistente que extrai texto de imagens.',
  'Analise a imagem fornecida e devolva JSON com:',
  '- "title": um título curto (máx. 80 caracteres) que resuma o conteúdo;',
  '- "text": o conteúdo textual completo, preservando quebras de linha e listas.',
  'Use o mesmo idioma da imagem (em geral português do Brasil).',
  'Se a imagem não contiver texto reconhecível, descreva-a brevemente.',
].join('\n');

export async function transcribeImage(args: {
  imageBase64: string;
  mimeType: string;
}): Promise<TranscribedContent> {
  let parsed: { title?: unknown; text?: unknown };
  try {
    parsed = await callClaude<{ title?: unknown; text?: unknown }>({
      content: [await imagePart(args.imageBase64, args.mimeType), { type: 'text', text: PROMPT }],
      maxTokens: 8000,
      schema: {
        type: 'object',
        properties: { title: { type: 'string' }, text: { type: 'string' } },
        required: ['title', 'text'],
        additionalProperties: false,
      },
    });
  } catch (e) {
    throw new AiTranscribeError(e instanceof Error ? e.message : String(e));
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
    text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
  };
}

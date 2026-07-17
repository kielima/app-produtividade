// Cliente Gemini para extrair texto de uma imagem partilhada via Web Share
// Target. Reutiliza o mesmo modelo configurado em `aiSubtasks.ts` e a chave
// guardada no Secret Manager do Firebase (ver src/lib/geminiClient.ts).

import { getGeminiModel } from './aiSubtasks';
import { callGemini } from './geminiClient';

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
  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: args.mimeType,
              data: args.imageBase64,
            },
          },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['title', 'text'],
      },
    },
  };

  let json;
  try {
    json = await callGemini(getGeminiModel(), body);
  } catch (e) {
    throw new AiTranscribeError(e instanceof Error ? e.message : String(e));
  }

  if (json.promptFeedback?.blockReason) {
    throw new AiTranscribeError(
      `Prompt bloqueado: ${json.promptFeedback.blockReason}`,
    );
  }

  const responseText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new AiTranscribeError('Resposta do Gemini sem conteúdo.');
  }

  let parsed: { title?: unknown; text?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new AiTranscribeError('JSON inválido na resposta do Gemini.');
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
    text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
  };
}

// Cliente Gemini para extrair texto de uma imagem partilhada via Web Share
// Target. Reutiliza a mesma chave/modelo configurados em `aiSubtasks.ts` —
// o utilizador só configura uma vez em Configurações > IA.

import { getGeminiApiKey, getGeminiModel } from './aiSubtasks';

export class AiTranscribeError extends Error {}

export interface TranscribedContent {
  title: string;
  text: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
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
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new AiTranscribeError(
      'Chave Gemini não configurada. Vá em Configurações > Inteligência Artificial.',
    );
  }

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
    throw new AiTranscribeError(
      `Falha de rede ao chamar Gemini: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const json = (await res.json().catch(() => null)) as GeminiResponse | null;

  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new AiTranscribeError(`Gemini respondeu erro: ${msg}`);
  }
  if (!json) {
    throw new AiTranscribeError('Resposta vazia do Gemini.');
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

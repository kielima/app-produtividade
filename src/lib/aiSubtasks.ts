// Cliente Gemini para gerar subtarefas a partir do título + nota de uma tarefa.
//
// A chave de API vive no Secret Manager do Firebase — a chamada real ao
// Gemini acontece na Cloud Function `callGemini` (ver src/lib/geminiClient.ts
// e functions/src/index.ts). Aqui só montamos o prompt/schema (não sigilosos)
// e escolhemos o modelo.

import { callGemini } from './geminiClient';

const MODEL_STORAGE = 'app-produtividade:gemini-model';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function getGeminiModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE) || DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function setGeminiModel(model: string): void {
  const trimmed = model.trim();
  if (trimmed && trimmed !== DEFAULT_GEMINI_MODEL) {
    localStorage.setItem(MODEL_STORAGE, trimmed);
  } else {
    localStorage.removeItem(MODEL_STORAGE);
  }
}

export function getDefaultGeminiModel(): string {
  return DEFAULT_GEMINI_MODEL;
}

export class AiSubtasksError extends Error {}

function buildPrompt(title: string, note: string, existingSubtasks: string[]): string {
  const noteBlock = note.trim()
    ? `\n\n## Anotações\n${note.trim()}`
    : '';
  const existingBlock = existingSubtasks.length
    ? `\n\n## Subtarefas já existentes (não duplicar)\n${existingSubtasks.map((s) => `- ${s}`).join('\n')}`
    : '';

  return [
    'Você é um assistente de produtividade. Quebre a tarefa abaixo em',
    'subtarefas concretas, acionáveis e ordenadas. Cada subtarefa deve ser',
    'curta (uma linha, idealmente < 80 caracteres) e começar com um verbo',
    'no infinitivo. Use o mesmo idioma do título (em geral português do',
    'Brasil). Gere entre 3 e 7 subtarefas. Não repita subtarefas que já',
    'existem.',
    '',
    `## Título\n${title}`,
    noteBlock,
    existingBlock,
  ].join('\n');
}

export async function generateSubtasks(args: {
  title: string;
  note: string;
  existingSubtasks: string[];
}): Promise<string[]> {
  const prompt = buildPrompt(args.title, args.note, args.existingSubtasks);

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['subtasks'],
      },
    },
  };

  let json;
  try {
    json = await callGemini(getGeminiModel(), body);
  } catch (e) {
    throw new AiSubtasksError(e instanceof Error ? e.message : String(e));
  }

  if (json.promptFeedback?.blockReason) {
    throw new AiSubtasksError(
      `Prompt bloqueado: ${json.promptFeedback.blockReason}`,
    );
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new AiSubtasksError('Resposta do Gemini sem conteúdo.');
  }

  let parsed: { subtasks?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiSubtasksError('JSON inválido na resposta do Gemini.');
  }

  if (!Array.isArray(parsed.subtasks)) {
    throw new AiSubtasksError('Campo "subtasks" ausente ou inválido.');
  }

  return parsed.subtasks
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

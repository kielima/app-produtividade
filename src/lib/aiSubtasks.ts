// Cliente Gemini para gerar subtarefas a partir do título + nota de uma tarefa.
//
// A chave de API fica só no localStorage do navegador do utilizador. Nunca
// entra no bundle nem no repositório. Por ser um app pessoal client-only com
// código aberto, esse é o padrão correto — nada de `VITE_*` aqui.

const API_KEY_STORAGE = 'app-produtividade:gemini-api-key';
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

export function getGeminiApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) {
    localStorage.setItem(API_KEY_STORAGE, trimmed);
  } else {
    localStorage.removeItem(API_KEY_STORAGE);
  }
}

export function hasGeminiApiKey(): boolean {
  return getGeminiApiKey().length > 0;
}

export class AiSubtasksError extends Error {}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

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
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new AiSubtasksError(
      'Chave Gemini não configurada. Vá em Configurações > Inteligência Artificial.',
    );
  }

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
    throw new AiSubtasksError(
      `Falha de rede ao chamar Gemini: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const json = (await res.json().catch(() => null)) as GeminiResponse | null;

  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new AiSubtasksError(`Gemini respondeu erro: ${msg}`);
  }
  if (!json) {
    throw new AiSubtasksError('Resposta vazia do Gemini.');
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

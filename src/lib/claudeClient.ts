// Chamador compartilhado das features de IA (subtarefas, transcrição de
// imagem, classificação de leitura, julgamento do Duelo). A chave da API da
// Anthropic nunca chega ao app: vive nos secrets da Edge Function
// `call-claude` (supabase/functions/call-claude), copiada do secret
// ANTHROPIC_API_KEY do repositório no GitHub — ver docs/IA.md. Aqui só se
// monta o pedido (instruções, conteúdo e JSON Schema, nada sigiloso).

import { callEdgeFunction } from './edgeFunctions';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — mais capaz (padrão)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — equilíbrio' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — mais rápido e barato' },
] as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[number]['id'];

const MODEL_STORAGE = 'app-produtividade:claude-model';
const DEFAULT_MODEL: ClaudeModel = 'claude-opus-5-5';

function isClaudeModel(v: unknown): v is ClaudeModel {
  return CLAUDE_MODELS.some((m) => m.id === v);
}

export function getClaudeModel(): ClaudeModel {
  try {
    const v = localStorage.getItem(MODEL_STORAGE);
    return isClaudeModel(v) ? v : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function setClaudeModel(model: ClaudeModel): void {
  try {
    if (model === DEFAULT_MODEL) localStorage.removeItem(MODEL_STORAGE);
    else localStorage.setItem(MODEL_STORAGE, model);
  } catch {
    // armazenamento indisponível: segue no padrão
  }
}

export function getDefaultClaudeModel(): ClaudeModel {
  return DEFAULT_MODEL;
}

export type ClaudePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string };

// Formatos de imagem que a API aceita; outros (BMP, HEIC…) são convertidos
// para PNG no navegador antes de enviar.
const IMAGENS_ACEITAS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function imagePart(data: string, mediaType: string): Promise<ClaudePart> {
  if (IMAGENS_ACEITAS.includes(mediaType)) return { type: 'image', mediaType, data };
  const png = await converterParaPng(data, mediaType);
  return { type: 'image', mediaType: 'image/png', data: png };
}

function converterParaPng(data: string, mediaType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas indisponível.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? '');
    };
    img.onerror = () => reject(new Error(`Formato de imagem não suportado: ${mediaType}.`));
    img.src = `data:${mediaType};base64,${data}`;
  });
}

/**
 * Pede ao Claude uma resposta em JSON que segue `schema` (structured
 * outputs: a API garante o formato). O schema precisa de
 * `additionalProperties: false` e `required` em todo objeto.
 */
export async function callClaude<T>(args: {
  content: ClaudePart[];
  schema: Record<string, unknown>;
  system?: string;
  maxTokens?: number;
}): Promise<T> {
  const res = await callEdgeFunction<{ data: T }>('call-claude', {
    model: getClaudeModel(),
    content: args.content,
    schema: args.schema,
    ...(args.system ? { system: args.system } : {}),
    ...(args.maxTokens ? { maxTokens: args.maxTokens } : {}),
  });
  return res.data;
}

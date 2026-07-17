// Chamador compartilhado das features de IA (subtarefas, transcrição de
// imagem, classificação de leitura). A chave da API Gemini vive só no
// Secret Manager do Firebase — este módulo chama a Cloud Function
// `callGemini` (functions/src/index.ts), que injeta a chave no servidor e
// repassa o corpo (prompt/schema, nada sigiloso) para o Gemini.

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

const callGeminiFn = httpsCallable<{ model: string; body: unknown }, GeminiResponse>(
  functions,
  'callGemini',
);

export async function callGemini(model: string, body: unknown): Promise<GeminiResponse> {
  const result = await callGeminiFn({ model, body });
  return result.data;
}

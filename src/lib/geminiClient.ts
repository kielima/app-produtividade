// Chamador compartilhado das features de IA (subtarefas, transcrição de
// imagem, classificação de leitura). A chave da API Gemini vive só nos
// secrets do Supabase — este módulo chama a Edge Function `call-gemini`
// (supabase/functions/call-gemini), que injeta a chave no servidor e
// repassa o corpo (prompt/schema, nada sigiloso) para o Gemini.

import { callEdgeFunction } from './edgeFunctions';

export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

export async function callGemini(model: string, body: unknown): Promise<GeminiResponse> {
  return callEdgeFunction<GeminiResponse>('call-gemini', { model, body });
}

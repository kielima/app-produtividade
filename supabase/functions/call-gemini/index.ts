// Proxy fino que injeta a chave de API do Gemini (guardada só no servidor).
// Equivalente a functions/src/index.ts `callGemini`.
import { handlePreflight, corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAuth, HttpError } from '../_shared/auth.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

interface GeminiErrorBody {
  error?: { message?: string };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const admin = supabaseAdmin();
  try {
    await requireAuth(req, admin);

    const { model, body } = await req.json().catch(() => ({}));
    if (!model || typeof body !== 'object' || body === null) {
      throw new HttpError(400, 'invalid-argument', 'model e body são obrigatórios.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    let res: Response;
    try {
      res = await fetch(`${endpoint}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new HttpError(503, 'unavailable', `Falha de rede ao chamar Gemini: ${e instanceof Error ? e.message : String(e)}`);
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (json as GeminiErrorBody | null)?.error?.message ?? `HTTP ${res.status}`;
      throw new HttpError(500, 'internal', `Gemini respondeu erro: ${msg}`);
    }
    if (!json) {
      throw new HttpError(500, 'internal', 'Resposta vazia do Gemini.');
    }

    return Response.json(json, { headers: corsHeaders });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'internal', String(e));
    return Response.json({ error: err.code, message: err.message }, { status: err.status, headers: corsHeaders });
  }
});

// Proxy das features de IA do app para a API da Anthropic (Claude).
//
// A chave (ANTHROPIC_API_KEY) vive só nos secrets desta Edge Function — o
// navegador nunca a vê. A fonte da chave é o secret ANTHROPIC_API_KEY do
// repositório no GitHub: o workflow .github/workflows/sync-anthropic-secret.yml
// copia de lá para cá (e republica esta função). Ver docs/IA.md.
//
// O cliente manda só o que não é sigiloso — instruções, conteúdo (texto e
// imagens) e o JSON Schema da resposta — e recebe o JSON já validado.
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { handlePreflight, corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAuth, HttpError } from '../_shared/auth.ts';

// Modelos que o app pode pedir. Qualquer outro valor cai no padrão — o
// cliente não escolhe um modelo arbitrário (nem um mais caro por engano).
const MODELOS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
type Modelo = (typeof MODELOS)[number];
const MODELO_PADRAO: Modelo = 'claude-opus-5-5';

// Os únicos formatos de imagem que a API aceita.
const TIPOS_DE_IMAGEM = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

interface ParteTexto {
  type: 'text';
  text: string;
}
interface ParteImagem {
  type: 'image';
  mediaType: string;
  data: string;
}
type Parte = ParteTexto | ParteImagem;

interface Pedido {
  model?: string;
  system?: string;
  content?: Parte[];
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
const client = apiKey ? new Anthropic({ apiKey }) : null;

function montarConteudo(partes: Parte[]): Anthropic.Beta.BetaContentBlockParam[] {
  return partes.map((p) => {
    if (p.type === 'text') {
      if (typeof p.text !== 'string' || !p.text) throw new HttpError(400, 'invalid-argument', 'Texto vazio.');
      return { type: 'text', text: p.text };
    }
    if (p.type === 'image') {
      if (!TIPOS_DE_IMAGEM.includes(p.mediaType as TipoDeImagem)) {
        throw new HttpError(400, 'invalid-argument', `Formato de imagem não aceito: ${p.mediaType}.`);
      }
      if (typeof p.data !== 'string' || !p.data) throw new HttpError(400, 'invalid-argument', 'Imagem vazia.');
      return {
        type: 'image',
        source: { type: 'base64', media_type: p.mediaType as TipoDeImagem, data: p.data },
      };
    }
    throw new HttpError(400, 'invalid-argument', 'Parte de conteúdo inválida.');
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const admin = supabaseAdmin();
  try {
    await requireAuth(req, admin);
    if (!client) {
      throw new HttpError(
        503,
        'unavailable',
        'A chave da Anthropic ainda não foi configurada (secret ANTHROPIC_API_KEY). Ver docs/IA.md.',
      );
    }

    const pedido = (await req.json().catch(() => ({}))) as Pedido;
    if (!Array.isArray(pedido.content) || pedido.content.length === 0) {
      throw new HttpError(400, 'invalid-argument', 'content é obrigatório.');
    }
    if (!pedido.schema || typeof pedido.schema !== 'object') {
      throw new HttpError(400, 'invalid-argument', 'schema é obrigatório.');
    }
    const model: Modelo = MODELOS.includes(pedido.model as Modelo) ? (pedido.model as Modelo) : MODELO_PADRAO;
    const maxTokens = Math.min(Math.max(Number(pedido.maxTokens) || 4096, 256), 16000);

    // Opus e Sonnet 5.5 podem recusar por engano (classificadores de
    // segurança); com `fallbacks: "default"` a própria API refaz o pedido no
    // modelo recomendado em vez de devolver a recusa. O Haiku não tem
    // fallback no servidor.
    const comFallback = model !== 'claude-haiku-5-5';

    let resposta: Anthropic.Beta.BetaMessage;
    try {
      resposta = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        ...(comFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        // Tarefas curtas e bem definidas (subtarefas, OCR, classificar,
        // julgar um par): esforço baixo basta e sai mais rápido e barato.
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: pedido.schema },
        },
        ...(pedido.system ? { system: pedido.system } : {}),
        messages: [{ role: 'user', content: montarConteudo(pedido.content) }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        throw new HttpError(500, 'internal', 'Chave da Anthropic inválida (secret ANTHROPIC_API_KEY).');
      }
      if (e instanceof Anthropic.RateLimitError) {
        throw new HttpError(429, 'resource-exhausted', 'Limite de uso da API da Anthropic atingido; tente de novo em instantes.');
      }
      if (e instanceof Anthropic.BadRequestError) {
        throw new HttpError(400, 'invalid-argument', `Pedido recusado pela API: ${e.message}`);
      }
      if (e instanceof Anthropic.APIError) {
        throw new HttpError(502, 'unavailable', `A API da Anthropic respondeu erro ${e.status ?? ''}: ${e.message}`);
      }
      throw new HttpError(503, 'unavailable', `Falha de rede ao chamar a Anthropic: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (resposta.stop_reason === 'refusal') {
      throw new HttpError(422, 'failed-precondition', 'O Claude recusou este pedido.');
    }
    if (resposta.stop_reason === 'max_tokens') {
      throw new HttpError(500, 'internal', 'A resposta do Claude passou do tamanho máximo.');
    }
    const texto = resposta.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!texto) throw new HttpError(500, 'internal', 'Resposta do Claude sem conteúdo.');

    let data: unknown;
    try {
      data = JSON.parse(texto);
    } catch {
      throw new HttpError(500, 'internal', 'JSON inválido na resposta do Claude.');
    }

    return Response.json({ data, model: resposta.model }, { headers: corsHeaders });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'internal', String(e));
    return Response.json({ error: err.code, message: err.message }, { status: err.status, headers: corsHeaders });
  }
});

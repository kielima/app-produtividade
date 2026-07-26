// Troca o authorization code do Google por tokens e guarda o refresh token.
// Chamada uma única vez, logo após o consentimento. Equivalente a
// functions/src/index.ts `connectCalendar`.
import { handlePreflight, corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAuth, HttpError } from '../_shared/auth.ts';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  TOKEN_ENDPOINT,
  CALENDAR_SCOPE,
  postForm,
  setRefreshToken,
  setConnectionStatus,
} from '../_shared/google.ts';

const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const admin = supabaseAdmin();
  try {
    const uid = await requireAuth(req, admin);
    const { code, redirectUri } = await req.json().catch(() => ({}));
    if (!code) {
      throw new HttpError(400, 'invalid-argument', 'code é obrigatório.');
    }

    const { status, json } = await postForm(TOKEN_ENDPOINT, {
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri ?? 'postmessage',
      grant_type: 'authorization_code',
    });

    if (status !== 200 || !json.access_token) {
      throw new HttpError(
        403,
        'permission-denied',
        json.error_description || json.error || 'Falha ao trocar o code com o Google.',
      );
    }
    if (!json.refresh_token) {
      throw new HttpError(
        412,
        'failed-precondition',
        'O Google não devolveu refresh token. Reconecte forçando o consentimento.',
      );
    }

    await setRefreshToken(uid, 'calendar', json.refresh_token, json.scope ?? CALENDAR_SCOPE);
    await setConnectionStatus(admin, uid, 'calendar', true);

    const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return Response.json({ accessToken: json.access_token, expiresAt }, { headers: corsHeaders });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'internal', String(e));
    return Response.json({ error: err.code, message: err.message }, { status: err.status, headers: corsHeaders });
  }
});

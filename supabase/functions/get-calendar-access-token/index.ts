// Emite um access token fresco a partir do refresh token guardado.
// Equivalente a functions/src/index.ts `getCalendarAccessToken`.
import { handlePreflight, corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAuth, HttpError } from '../_shared/auth.ts';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  TOKEN_ENDPOINT,
  postForm,
  getRefreshToken,
  deleteRefreshToken,
  setConnectionStatus,
} from '../_shared/google.ts';

const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const admin = supabaseAdmin();
  try {
    const uid = await requireAuth(req, admin);
    const refreshToken = await getRefreshToken(uid, 'calendar');
    if (!refreshToken) {
      return Response.json({ status: 'needs-connect' }, { headers: corsHeaders });
    }

    const { status, json } = await postForm(TOKEN_ENDPOINT, {
      refresh_token: refreshToken,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });

    if (status === 200 && json.access_token) {
      const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
      return Response.json({ status: 'ok', accessToken: json.access_token, expiresAt }, { headers: corsHeaders });
    }

    if (json.error === 'invalid_grant') {
      await deleteRefreshToken(uid, 'calendar').catch(() => undefined);
      await setConnectionStatus(admin, uid, 'calendar', false).catch(() => undefined);
      return Response.json({ status: 'needs-reconnect' }, { headers: corsHeaders });
    }

    throw new HttpError(500, 'internal', json.error_description || json.error || 'Falha ao renovar o token.');
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'internal', String(e));
    return Response.json({ error: err.code, message: err.message }, { status: err.status, headers: corsHeaders });
  }
});

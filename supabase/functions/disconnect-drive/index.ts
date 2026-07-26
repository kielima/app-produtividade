// Mesma lógica de disconnect-calendar, mas para o Google Drive.
// Equivalente a functions/src/index.ts `disconnectDrive`.
import { handlePreflight, corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAuth, HttpError } from '../_shared/auth.ts';
import { REVOKE_ENDPOINT, postForm, getRefreshToken, deleteRefreshToken, setConnectionStatus } from '../_shared/google.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const admin = supabaseAdmin();
  try {
    const uid = await requireAuth(req, admin);
    const refreshToken = await getRefreshToken(uid, 'drive');

    if (refreshToken) {
      await postForm(REVOKE_ENDPOINT, { token: refreshToken }).catch(() => undefined);
    }
    await deleteRefreshToken(uid, 'drive').catch(() => undefined);
    await setConnectionStatus(admin, uid, 'drive', false).catch(() => undefined);

    return Response.json({ status: 'ok' }, { headers: corsHeaders });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'internal', String(e));
    return Response.json({ error: err.code, message: err.message }, { status: err.status, headers: corsHeaders });
  }
});

// =============================================================
// Cloud Functions — fluxo OAuth do Google Calendar com refresh token
// guardado no servidor.
//
// Por que isso existe: no navegador o token de acesso do Google dura ~1h e a
// renovação silenciosa via GIS depende de cookies de terceiros (bloqueados por
// Safari/Firefox/Chrome), o que forçava popups recorrentes de "Reconectar".
// Aqui o cliente consente UMA vez (authorization-code com access_type=offline),
// o refresh token fica só no servidor (Firestore, caminho server-only) e estas
// funções emitem access tokens novos sob demanda — sem popup, sem cookies,
// para qualquer dispositivo do mesmo usuário.
// =============================================================

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();
setGlobalOptions({ region: 'us-central1' });

// O Client ID do OAuth é PÚBLICO (já vai embutido no frontend e no deploy.yml),
// então não precisa ser secret — fica como constante. O mesmo valor está em
// VITE_GOOGLE_OAUTH_CLIENT_ID. Só o client secret é sigiloso e vive no Secret
// Manager.
const GOOGLE_OAUTH_CLIENT_ID =
  '739803156090-n0f203p9io7276nm1uujsauntue6l644.apps.googleusercontent.com';
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// Caminhos no Firestore:
// - users/{uid}/private/calendar  → refresh token (SOMENTE Admin SDK; regras negam o cliente)
// - users/{uid}/calendar/status   → flag não sensível { connected } (cliente lê)
function secretDocRef(uid: string) {
  return getFirestore().doc(`users/${uid}/private/calendar`);
}
function statusDocRef(uid: string) {
  return getFirestore().doc(`users/${uid}/calendar/status`);
}

function requireAuth(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Login necessário.');
  }
  return uid;
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<{ status: number; json: GoogleTokenResponse }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let json: GoogleTokenResponse = {};
  try {
    json = (await res.json()) as GoogleTokenResponse;
  } catch {
    // resposta sem corpo JSON (ex.: revoke) — segue com objeto vazio
  }
  return { status: res.status, json };
}

// -------------------------------------------------------------
// connectCalendar — troca o authorization code por tokens e guarda o
// refresh token. Chamada uma única vez, logo após o consentimento.
// -------------------------------------------------------------
export const connectCalendar = onCall(
  { secrets: [GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
    const uid = requireAuth(request);
    const code = (request.data?.code ?? '') as string;
    if (!code) {
      throw new HttpsError('invalid-argument', 'code é obrigatório.');
    }
    // Com o code client do GIS em ux_mode 'popup', a troca usa o
    // redirect_uri especial 'postmessage'.
    const redirectUri = (request.data?.redirectUri ?? 'postmessage') as string;

    const { status, json } = await postForm(TOKEN_ENDPOINT, {
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET.value(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    if (status !== 200 || !json.access_token) {
      throw new HttpsError(
        'permission-denied',
        json.error_description || json.error || 'Falha ao trocar o code com o Google.',
      );
    }
    if (!json.refresh_token) {
      // Sem refresh token o "conectar uma vez" não se sustenta. Acontece quando
      // o consentimento não foi forçado (prompt=consent). Peça reconsentimento.
      throw new HttpsError(
        'failed-precondition',
        'O Google não devolveu refresh token. Reconecte forçando o consentimento.',
      );
    }

    await secretDocRef(uid).set(
      {
        refreshToken: json.refresh_token,
        scope: json.scope ?? CALENDAR_SCOPE,
        connectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await statusDocRef(uid).set(
      { connected: true, connectedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return { accessToken: json.access_token, expiresAt };
  },
);

// -------------------------------------------------------------
// getCalendarAccessToken — emite um access token fresco a partir do refresh
// token guardado. É o que substitui o iframe silencioso do GIS.
// -------------------------------------------------------------
export const getCalendarAccessToken = onCall(
  { secrets: [GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
    const uid = requireAuth(request);
    const snap = await secretDocRef(uid).get();
    const refreshToken = snap.exists ? (snap.get('refreshToken') as string | undefined) : undefined;
    if (!refreshToken) {
      return { status: 'needs-connect' as const };
    }

    const { status, json } = await postForm(TOKEN_ENDPOINT, {
      refresh_token: refreshToken,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET.value(),
      grant_type: 'refresh_token',
    });

    if (status === 200 && json.access_token) {
      const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
      return { status: 'ok' as const, accessToken: json.access_token, expiresAt };
    }

    // invalid_grant = refresh token revogado/expirado. Limpa o estado para o
    // cliente saber que precisa reconectar (consentir de novo).
    if (json.error === 'invalid_grant') {
      await secretDocRef(uid).delete().catch(() => undefined);
      await statusDocRef(uid)
        .set({ connected: false }, { merge: true })
        .catch(() => undefined);
      return { status: 'needs-reconnect' as const };
    }

    throw new HttpsError(
      'internal',
      json.error_description || json.error || 'Falha ao renovar o token.',
    );
  },
);

// -------------------------------------------------------------
// disconnectCalendar — revoga no Google e apaga o estado guardado.
// -------------------------------------------------------------
export const disconnectCalendar = onCall(
  { secrets: [GOOGLE_OAUTH_CLIENT_SECRET] },
  async (request) => {
    const uid = requireAuth(request);
    const snap = await secretDocRef(uid).get();
    const refreshToken = snap.exists ? (snap.get('refreshToken') as string | undefined) : undefined;

    if (refreshToken) {
      // Best-effort: mesmo que a revogação falhe, apagamos o estado local.
      await postForm(REVOKE_ENDPOINT, { token: refreshToken }).catch(() => undefined);
    }
    await secretDocRef(uid).delete().catch(() => undefined);
    await statusDocRef(uid).set({ connected: false }, { merge: true }).catch(() => undefined);

    return { status: 'ok' as const };
  },
);

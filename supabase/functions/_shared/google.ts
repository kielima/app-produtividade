import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3';

// Client ID do OAuth é PÚBLICO (mesmo valor de VITE_GOOGLE_OAUTH_CLIENT_ID no
// frontend) — só o client secret é sigiloso e vem de Deno.env via `supabase
// secrets set GOOGLE_OAUTH_CLIENT_SECRET=...`.
export const GOOGLE_OAUTH_CLIENT_ID =
  '739803156090-n0f203p9io7276nm1uujsauntue6l644.apps.googleusercontent.com';

export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
// Escopo completo (não drive.file): a aba Leitura lista/renomeia arquivos que
// não foram criados pelo app, então precisa do escopo `drive` amplo.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

export type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export async function postForm(
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

export type OAuthProvider = 'calendar' | 'drive';

// private.oauth_tokens não está em [api].schemas (supabase/config.toml) —
// o PostgREST recusa qualquer acesso a esse schema, mesmo com service_role.
// Por isso o acesso é via conexão direta ao Postgres (SUPABASE_DB_URL,
// injetada automaticamente em toda Edge Function), nunca via supabase-js.
// Equivalente a users/{uid}/private/{provider} (bloqueado até pro dono nas
// firestore.rules atuais).
function db() {
  return postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false });
}

export async function getRefreshToken(uid: string, provider: OAuthProvider): Promise<string | null> {
  const sql = db();
  try {
    const rows = await sql`
      select refresh_token from private.oauth_tokens
      where user_id = ${uid} and provider = ${provider}
    `;
    return (rows[0]?.refresh_token as string | undefined) ?? null;
  } finally {
    await sql.end();
  }
}

export async function setRefreshToken(
  uid: string,
  provider: OAuthProvider,
  refreshToken: string,
  scope: string,
): Promise<void> {
  const sql = db();
  try {
    await sql`
      insert into private.oauth_tokens (user_id, provider, refresh_token, scope, connected_at, updated_at)
      values (${uid}, ${provider}, ${refreshToken}, ${scope}, now(), now())
      on conflict (user_id, provider)
      do update set refresh_token = excluded.refresh_token, scope = excluded.scope, updated_at = now()
    `;
  } finally {
    await sql.end();
  }
}

export async function deleteRefreshToken(uid: string, provider: OAuthProvider): Promise<void> {
  const sql = db();
  try {
    await sql`delete from private.oauth_tokens where user_id = ${uid} and provider = ${provider}`;
  } finally {
    await sql.end();
  }
}

// public.connection_status — flag não sensível que o cliente só lê.
export async function setConnectionStatus(
  admin: SupabaseClient,
  uid: string,
  provider: OAuthProvider,
  connected: boolean,
): Promise<void> {
  await admin
    .from('connection_status')
    .upsert(
      { user_id: uid, provider, connected, connected_at: connected ? new Date().toISOString() : null },
      { onConflict: 'user_id,provider' },
    );
}

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// Equivalente ao requireAuth(request) das Cloud Functions: extrai o uid a
// partir do JWT que supabase.functions.invoke() já injeta no header
// Authorization. admin.auth.getUser(jwt) valida o token independente do
// papel (service_role) do client usado pra chamar.
export async function requireAuth(req: Request, admin: SupabaseClient): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) {
    throw new HttpError(401, 'unauthenticated', 'Login necessário.');
  }
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) {
    throw new HttpError(401, 'unauthenticated', 'Login necessário.');
  }
  return data.user.id;
}

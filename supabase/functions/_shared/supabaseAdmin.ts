import { createClient } from 'npm:@supabase/supabase-js@2';

// service_role: ignora RLS — só usado dentro das Edge Functions, nunca exposto ao cliente.
// Equivalente ao Admin SDK do Firebase usado nas Cloud Functions atuais.
export function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

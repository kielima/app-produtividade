import { createClient } from 'npm:@supabase/supabase-js@2';

// service_role: ignora RLS — só usado dentro das Edge Functions, nunca exposto ao cliente.
// Equivalente ao Admin SDK do Firebase usado nas Cloud Functions atuais.
// O schema `produtividade` (e não `public`) vem da consolidação dos dois
// projetos Supabase num só — ver supabase/migrations/20260812120000. É o que
// faz `.from('connection_status')` em _shared/google.ts continuar resolvendo.
export function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'produtividade' } },
  );
}

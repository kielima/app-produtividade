import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

// No WebView do APK (Capacitor), `navigator.onLine` às vezes retorna `false`
// mesmo com internet — herdado do mesmo workaround que o Firestore precisava
// (ver histórico de src/lib/firebase.ts). Não é específico de nenhum backend:
// é o WebView do Android que mente sobre conectividade. Mantido aqui porque
// o supabase-js/fetch também consulta essa flag em alguns pontos de retry.
if (Capacitor.isNativePlatform() && typeof navigator !== 'undefined') {
  try {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('online'));
    }
  } catch {
    // se o navegador não deixar redefinir, segue sem — não piora nada
  }
}

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// O projeto Supabase é compartilhado com o app wishlist (consolidação dos dois
// projetos num só), então as tabelas deste app vivem no schema `produtividade`
// em vez do `public` — ver supabase/migrations/20260812120000. Definir o schema
// aqui faz todo `.from()` dos repositórios resolver para `produtividade.*` sem
// mudar nenhum call site. Storage e Auth não são afetados: usam endpoints
// próprios, fora do PostgREST.
// O schema entra nos parâmetros de tipo: `SupabaseClient` sem argumentos fixa
// "public" na assinatura e deixa de bater com o cliente criado abaixo.
export const supabase: SupabaseClient<any, 'produtividade', 'produtividade'> = createClient(url, anonKey, {
  db: {
    schema: 'produtividade',
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

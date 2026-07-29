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

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

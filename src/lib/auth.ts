import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { supabase } from './supabase';

// No navegador o login é via popup OAuth (Supabase Auth + provider Google).
// Dentro do WebView do app (Capacitor) o popup não devolve o resultado — o
// fluxo trava no "Entrando…". Por isso, no APK usamos o Google Sign-In
// NATIVO via @capacitor-firebase/authentication com `skipNativeAuth: true`
// (ver capacitor.config.ts): nesse modo o plugin SÓ abre o seletor de contas
// nativo do Android e devolve um idToken do Google — ele nunca estabelece
// sessão com o Firebase. Como esse idToken é um ID token genuíno do Google,
// entregamos direto pro Supabase (`signInWithIdToken`), sem popup e sem
// depender de mais nada do Firebase.
//
// A dependência `firebase` continua no package.json só porque o bundle WEB
// do @capacitor-firebase/authentication importa estaticamente `firebase/auth`
// (fallback pra rodar no navegador) — sem o pacote instalado o build do Vite
// quebra, mesmo esse código nunca sendo executado aqui (só chamamos
// FirebaseAuthentication em Capacitor.isNativePlatform()). Trocar por um
// plugin de Google Sign-In nativo puro (Fase 5 do plano de migração) remove
// essa dependência de vez.
export async function signInWithGoogle(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Login nativo do Google não retornou idToken.');
    }
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw error;
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOutCurrent(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    // Encerra também a sessão nativa do Google, senão o próximo login reusa a
    // conta anterior sem perguntar.
    await FirebaseAuthentication.signOut().catch(() => {});
  }
  await supabase.auth.signOut();
}

export function isPopupClosedByUser(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const message = (e as { message?: string }).message ?? '';
  const code = (e as { code?: string }).code;
  return (
    /popup/i.test(message) ||
    code === '12501' ||
    code === 'sign_in_canceled'
  );
}

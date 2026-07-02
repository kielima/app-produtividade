import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from './firebase';

const provider = new GoogleAuthProvider();

// No navegador o login é via popup OAuth. Dentro do WebView do app (Capacitor)
// o popup do Google não devolve o resultado — o fluxo trava no "Entrando…".
// Por isso, no APK usamos o Google Sign-In NATIVO (@capacitor-firebase/
// authentication): ele abre o seletor de contas do Android, devolve um idToken
// e nós trocamos esse token por uma credencial do Firebase (signInWithCredential),
// sem popup nenhum.
export async function signInWithGoogle(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Login nativo do Google não retornou idToken.');
    }
    const credential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(auth, credential);
    return;
  }
  await signInWithPopup(auth, provider);
}

export async function signOutCurrent(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    // Encerra também a sessão nativa do Google, senão o próximo login reusa a
    // conta anterior sem perguntar.
    await FirebaseAuthentication.signOut().catch(() => {});
  }
  await signOut(auth);
}

export function isPopupClosedByUser(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: string }).code;
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    // Equivalentes do fluxo nativo quando o usuário fecha o seletor de contas.
    code === '12501' ||
    code === 'sign_in_canceled'
  );
}

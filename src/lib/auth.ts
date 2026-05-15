import {
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase';

// Email fixo — só serve pra dar conformidade ao formato exigido pelo
// Firebase Auth. O usuário nunca vê esse valor; o login é só PIN.
const PIN_EMAIL = 'pin@app-produtividade.local';

export const PIN_LENGTH = 6;

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function signInWithPin(pin: string): Promise<void> {
  await setPersistence(auth, browserSessionPersistence);
  await signInWithEmailAndPassword(auth, PIN_EMAIL, pin);
}

export async function createPinAccount(pin: string): Promise<void> {
  await setPersistence(auth, browserSessionPersistence);
  await createUserWithEmailAndPassword(auth, PIN_EMAIL, pin);
}

export async function signOutCurrent(): Promise<void> {
  await signOut(auth);
}

/**
 * Distingue "PIN errado / conta não existe" de erros inesperados.
 * Firebase v10+ usa `auth/invalid-credential` como código guarda-chuva
 * por causa da proteção contra enumeração de email.
 */
export function isInvalidCredential(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: string }).code;
  return (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  );
}

export function isEmailAlreadyInUse(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  return (e as { code?: string }).code === 'auth/email-already-in-use';
}

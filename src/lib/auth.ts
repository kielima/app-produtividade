import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase';

const provider = new GoogleAuthProvider();

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, provider);
}

export async function signOutCurrent(): Promise<void> {
  await signOut(auth);
}

export function isPopupClosedByUser(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: string }).code;
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}

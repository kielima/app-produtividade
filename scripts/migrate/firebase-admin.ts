import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

/**
 * Inicializa o Admin SDK. Prioridade:
 * 1. Caminho explícito via GOOGLE_APPLICATION_CREDENTIALS (.env)
 * 2. ADC (gcloud auth application-default login)
 */
export function initAdmin(): void {
  if (getApps().length > 0) return;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    const json = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    initializeApp({ credential: cert(json), projectId: json.project_id });
  } else {
    initializeApp({ credential: applicationDefault() });
  }
}

export function adminDb() {
  initAdmin();
  return getFirestore();
}

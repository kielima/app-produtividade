import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from 'firebase/functions';
import { Capacitor } from '@capacitor/core';

// Região das Cloud Functions — precisa bater com a definida em functions/src.
const FUNCTIONS_REGION = 'us-central1';

// No WebView do APK (Capacitor) duas coisas do Firestore quebram e são tratadas
// só no nativo (no navegador nada muda):
//  - Cache: a persistência em IndexedDB falha dentro do WebView
//    (IndexedDbTransactionError code=unavailable / AbortError), e como TODA
//    query passa pelo cache, "nada carrega". Usamos cache EM MEMÓRIA, que não
//    toca no IndexedDB. Custo: sem persistência offline no APK (recarrega do
//    servidor a cada abertura) — aceitável.
//  - Rede: o transporte padrão (WebChannel via streaming fetch) às vezes não
//    conecta no WebView; forçar long polling é mais robusto.
const isNativePlatform = Capacitor.isNativePlatform();

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

export const app: FirebaseApp = initializeApp(config);

export const db: Firestore = initializeFirestore(app, {
  // Campos opcionais vazios chegam como `undefined` (ex.: isbn/doi/issn no
  // editor de metadados). Sem isto o Firestore rejeita a gravação inteira
  // ("Unsupported field value: undefined"); com isto ele apenas ignora o campo.
  ignoreUndefinedProperties: true,
  // Ver comentário acima: no APK forçamos long polling para o Firestore
  // conseguir sincronizar dentro do WebView.
  ...(isNativePlatform ? { experimentalForceLongPolling: true } : {}),
  // No APK, cache em memória (IndexedDB falha no WebView); no navegador,
  // persistência em IndexedDB com suporte a múltiplas abas.
  localCache: isNativePlatform
    ? memoryLocalCache()
    : persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
});

export const auth: Auth = getAuth(app);

// Cloud Functions: backend que detém o refresh token do Google Calendar e
// emite access tokens novos sem popup.
export const functions: Functions = getFunctions(app, FUNCTIONS_REGION);

// Login com Google é via popup OAuth — manter sessão entre visitas evita
// re-fazer o fluxo toda vez. Fire-and-forget: a primeira chamada de signIn
// vai re-aplicar isso de qualquer jeito.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('Falha ao configurar persistência:', err);
});

if (useEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8081);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

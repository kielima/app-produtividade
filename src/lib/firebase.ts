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

// No WebView do APK (Capacitor) o transporte padrão do Firestore (WebChannel via
// streaming fetch) não estabelece conexão — a autenticação funciona, mas as
// queries ficam penduradas e só servem o cache local (vazio numa instalação
// nova), então "nada carrega". Forçar long polling resolve. Só no nativo: no
// navegador o WebChannel é mais eficiente e funciona normalmente.
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
  localCache: persistentLocalCache({
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

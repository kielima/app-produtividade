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

// Em alguns WebView do Android, `navigator.onLine` retorna `false` mesmo com
// internet. O monitor de conectividade do Firestore lê essa flag e declara o
// cliente "offline", travando as queries ("Failed to get document because the
// client is offline") — mesmo com a rede funcionando (o login, que não passa
// pelo Firestore, funciona). No APK forçamos onLine=true e emitimos o evento
// 'online' para o Firestore reconhecer que está conectado. Roda ANTES de
// initializeFirestore para o monitor já iniciar em estado online.
if (isNativePlatform && typeof navigator !== 'undefined') {
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
  // conseguir sincronizar dentro do WebView. `useFetchStreams: false` é o par
  // obrigatório em WebView Android: o fetch com resposta em streaming é
  // quebrado em vários WebViews e derruba o transporte mesmo em long polling
  // ("client is offline" com a rede funcionando). A opção existe no SDK mas
  // não está nas typings públicas — daí o cast.
  ...(isNativePlatform
    ? ({
        experimentalForceLongPolling: true,
        useFetchStreams: false,
      } as object)
    : {}),
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

import type { CapacitorConfig } from '@capacitor/cli';

// Empacotamento Android (Capacitor). O app web é buildado para `dist/` e
// embarcado num WebView; a versão APK existe sobretudo para acessar o botão da
// S-Pen (não exposto ao navegador comum) via ponte nativa — ver
// android/app/src/main/java/.../MainActivity.java.
const config: CapacitorConfig = {
  appId: 'com.kielima.produtividade',
  appName: 'Produtividade',
  webDir: 'dist',
  android: {
    // Permite conteúdo misto durante desenvolvimento não é necessário; mantemos
    // o padrão seguro.
    allowMixedContent: false,
  },
  plugins: {
    // Login com Google nativo no APK. `skipNativeAuth: true` porque quem
    // mantém a sessão é o Firebase JS SDK (signInWithCredential em auth.ts); o
    // plugin só faz o Google Sign-In nativo e devolve o idToken.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;

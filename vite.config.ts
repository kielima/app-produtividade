import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' descarrega o novo SW em background mas espera o usuário
      // confirmar pra ativar (skipWaiting via updateSW). Pareado com o
      // toast "nova versão disponível" em src/components/UpdatePrompt.tsx.
      registerType: 'prompt',
      // Registro APENAS pelo hook useRegisterSW (UpdatePrompt), que no APK
      // (Capacitor) é pulado — um service worker no WebView intercepta
      // requisições e persiste entre reinícios, quebrando a sincronização.
      // 'auto' injetaria um script de registro no index.html, contornando esse
      // controle; por isso desligamos (null).
      injectRegister: null,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Produtividade — Kiê',
        short_name: 'Produtividade',
        description: 'PWA pessoal de tarefas, projetos e memória',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f3ede3',
        theme_color: '#2b2b2b',
        lang: 'pt-BR',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'image',
                accept: ['image/*'],
              },
            ],
          },
        },
      },
      workbox: {
        // App shell: precache do bundle React/CSS/etc gerado pelo Vite.
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ico}'],
        // Script auxiliar pra intercetar POST do Web Share Target (workbox
        // só lida com GET por defeito). Ver public/share-target-sw.js.
        importScripts: ['share-target-sw.js'],
        navigateFallback: '/index.html',
        // Não interceptar URLs do Firebase — o SDK já tem IndexedDB offline.
        navigateFallbackDenylist: [
          /^\/__\/auth\//,
          /^\/__\/firebase\//,
          /firestore\.googleapis\.com/,
          /identitytoolkit\.googleapis\.com/,
        ],
        runtimeCaching: [
          // Fontes do Google (caso sejam adicionadas no futuro): cache 1 ano.
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' ||
              url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 },
            },
          },
        ],
        // Não cachear nada relacionado a Firebase: deixa o SDK gerenciar.
        // (não há entry pra firestore.googleapis.com no runtimeCaching).
      },
      devOptions: {
        enabled: false, // SW só ativo em prod build
      },
    }),
  ],
  server: { port: 5173 },
});

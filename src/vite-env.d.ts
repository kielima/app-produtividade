/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Carimbo de build (commit + data) injetado pelo Vite (define em vite.config.ts).
declare const __APP_BUILD__: string;
// Commit completo da build atual, para comparar com a versão publicada.
declare const __APP_COMMIT__: string;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

// Web Share Target via POST + multipart: o service worker
// (public/share-target-sw.js) processa a partilha e redireciona pra
// /?shared=1. O App.tsx lê o payload do Cache e despacha o fluxo.
if (window.location.search.includes('shared=1')) {
  sessionStorage.setItem('pendingShareFromCache', '1');
  window.history.replaceState(null, '', '/');
}

// Caminho legado (GET share_target) — mantido como defesa caso uma versão
// antiga do SW ainda esteja ativa no dispositivo.
if (window.location.pathname === '/share-target') {
  const p = new URLSearchParams(window.location.search);
  sessionStorage.setItem('pendingShare', JSON.stringify({
    title: p.get('title') ?? '',
    text: p.get('text') ?? '',
    url: p.get('url') ?? '',
  }));
  window.history.replaceState(null, '', '/');
}

// Partilha nativa (APK): MainActivity intercepta ACTION_SEND de outros apps
// e navega o WebView pra cá com os extras do Intent na query string (ver
// android/.../MainActivity.java#handleShareIntent). Reaproveita o mesmo
// formato de payload do fluxo legado acima.
if (window.location.search.includes('native_share=1')) {
  const p = new URLSearchParams(window.location.search);
  sessionStorage.setItem('pendingShare', JSON.stringify({
    title: p.get('title') ?? '',
    text: p.get('text') ?? '',
    url: p.get('url') ?? '',
  }));
  window.history.replaceState(null, '', '/');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

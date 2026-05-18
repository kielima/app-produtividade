import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

if (window.location.pathname === '/share-target') {
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

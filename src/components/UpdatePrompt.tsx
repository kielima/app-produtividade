import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Capacitor } from '@capacitor/core';

// No APK (Capacitor) o app já roda local no WebView e NÃO deve ter service
// worker: um SW ativo intercepta as requisições (inclusive as do Firestore) e
// persiste entre reinícios do app, causando "nada carrega" e telas que não
// montam — sintomas que sobrevivem a fechar/abrir. Por isso, no nativo, não
// registramos o SW e ainda removemos qualquer um remanescente de uma versão
// anterior.
const isNative = Capacitor.isNativePlatform();

export function UpdatePrompt() {
  return isNative ? <NativeSwCleanup /> : <WebUpdatePrompt />;
}

// Nativo: desregistra qualquer service worker/caches deixados por builds antigos
// e não renderiza nada.
function NativeSwCleanup() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }
  }, []);
  return null;
}

/**
 * Toast canto-inferior-direito (apenas web/PWA). Aparece quando o
 * vite-plugin-pwa detecta que há um novo bundle disponível (novo build
 * deployado) ou quando o usuário fica offline e o app shell foi precacheado
 * com sucesso.
 *
 * Botão "Recarregar" chama updateServiceWorker(true) → skipWaiting + reload da
 * página, ativando o novo SW.
 */
function WebUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      // Log silencioso pra debugging (Console > Application > SW).
      console.info('[PWA] service worker registered:', swUrl);
    },
    onRegisterError(err) {
      console.error('[PWA] SW registration error:', err);
    },
  });

  const [closed, setClosed] = useState(false);

  // Auto-dismiss da mensagem de "pronto offline" depois de 4s.
  useEffect(() => {
    if (offlineReady) {
      const t = setTimeout(() => setOfflineReady(false), 4000);
      return () => clearTimeout(t);
    }
  }, [offlineReady, setOfflineReady]);

  function close() {
    setOfflineReady(false);
    setNeedRefresh(false);
    setClosed(true);
  }

  if (closed) return null;
  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="pwa-toast" role="status" aria-live="polite">
      <div className="pwa-toast-msg">
        {needRefresh
          ? 'Nova versão disponível.'
          : 'App pronto para uso offline.'}
      </div>
      <div className="pwa-toast-actions">
        {needRefresh && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => updateServiceWorker(true)}
          >
            Recarregar
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={close}>
          Fechar
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Toast canto-inferior-direito. Aparece quando o vite-plugin-pwa detecta
 * que há um novo bundle disponível (novo build deployado) ou quando o
 * usuário fica offline e o app shell foi precacheado com sucesso.
 *
 * Botão "Recarregar" chama updateSW(true) → skipWaiting + reload da
 * página, ativando o novo SW.
 */
export function UpdatePrompt() {
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

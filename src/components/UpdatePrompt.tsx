import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Capacitor } from '@capacitor/core';
import { instalarAtualizacao } from '../lib/atualizacao';
import {
  startAutoUpdateCheck,
  useAutoUpdateInfo,
  dismissAutoUpdateInfo,
} from '../lib/autoUpdateCheck';

// No APK (Capacitor) o app já roda local no WebView e NÃO deve ter service
// worker: um SW ativo intercepta as requisições (inclusive as do Firestore) e
// persiste entre reinícios do app, causando "nada carrega" e telas que não
// montam — sintomas que sobrevivem a fechar/abrir. Por isso, no nativo, não
// registramos o SW e ainda removemos qualquer um remanescente de uma versão
// anterior.
const isNative = Capacitor.isNativePlatform();

export function UpdatePrompt() {
  return isNative ? <NativeUpdateCheck /> : <WebUpdatePrompt />;
}

// Nativo: desregistra qualquer service worker/caches deixados por builds
// antigos, dispara a checagem automática de atualização em segundo plano
// (ver src/lib/autoUpdateCheck.ts) e mostra um toast quando ela encontra uma
// build nova publicada.
function NativeUpdateCheck() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }
    startAutoUpdateCheck();
  }, []);

  const info = useAutoUpdateInfo();
  const [instalando, setInstalando] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!info?.disponivel || !info.urlApk) return null;
  const urlApk = info.urlApk;

  async function instalar() {
    setErro(null);
    setInstalando(true);
    try {
      await instalarAtualizacao(urlApk);
      setStatus('Baixando… acompanhe na barra de notificações.');
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : 'Falha ao baixar/instalar.',
      );
    } finally {
      setInstalando(false);
    }
  }

  function close() {
    setStatus(null);
    setErro(null);
    dismissAutoUpdateInfo();
  }

  return (
    <div className="pwa-toast" role="status" aria-live="polite">
      <div className="pwa-toast-msg">
        Nova versão disponível
        {info.commitRemoto && ` · ${info.commitRemoto}`}.
        {status && (
          <>
            <br />
            {status}
          </>
        )}
        {erro && (
          <>
            <br />
            <span className="error">{erro}</span>
          </>
        )}
      </div>
      <div className="pwa-toast-actions">
        {!status && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void instalar()}
            disabled={instalando}
          >
            {instalando ? 'Baixando…' : 'Baixar e instalar'}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={close}>
          Fechar
        </button>
      </div>
    </div>
  );
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
    onRegisteredSW(swUrl, registration) {
      // Log silencioso pra debugging (Console > Application > SW).
      console.info('[PWA] service worker registered:', swUrl);
      if (!registration) return;
      // Por padrão o navegador só checa por um SW novo na navegação/registro
      // inicial — um PWA instalado que fica aberto/em segundo plano por dias
      // (comum no celular) pode nunca chegar a ver o toast "nova versão
      // disponível". Reforça a checagem ao voltar o foco (caso mais comum:
      // reabrir o app) e periodicamente enquanto fica aberto.
      const check = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
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

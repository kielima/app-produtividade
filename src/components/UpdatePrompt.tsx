import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Capacitor } from '@capacitor/core';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

// No APK (Capacitor) o app já roda local no WebView e NÃO deve ter service
// worker: um SW ativo intercepta as requisições (inclusive as do Firestore) e
// persiste entre reinícios do app, causando "nada carrega" e telas que não
// montam — sintomas que sobrevivem a fechar/abrir. Por isso, no nativo, não
// registramos o SW e ainda removemos qualquer um remanescente de uma versão
// anterior.
const isNative = Capacitor.isNativePlatform();

export function UpdatePrompt() {
  return isNative ? (
    <>
      <NativeSwCleanup />
      <NativeDiagnostics />
    </>
  ) : (
    <WebUpdatePrompt />
  );
}

// -------------------------------------------------------------------------
// TEMPORÁRIO (debug do APK): o Firestore fica "client is offline" só no
// WebView. Este painel testa a rede do WebView por dentro e mostra o resultado
// na tela — um print dele diz exatamente em qual camada quebra (DNS/alcance,
// XHR, token de auth, REST do Firestore, SDK). Remover quando o APK estiver
// estável.
// -------------------------------------------------------------------------
let diagCache: string[] | null = null;

function NativeDiagnostics() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>(diagCache ?? []);
  const [running, setRunning] = useState(false);

  async function run() {
    if (running) return;
    setRunning(true);
    const out: string[] = [];
    const push = (s: string) => {
      out.push(s);
      diagCache = [...out];
      setLines(diagCache);
    };
    const msg = (e: unknown) =>
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);

    const pid = (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || '';
    push(`projectId: ${pid || '(VAZIO!)'}`);
    push(`onLine: ${String(navigator.onLine)}`);

    // 1. Alcance por fetch (qualquer status HTTP = host alcançável)
    try {
      const r = await fetch('https://firestore.googleapis.com/', { method: 'GET' });
      push(`fetch firestore.googleapis.com: HTTP ${r.status}`);
    } catch (e) {
      push(`fetch firestore.googleapis.com: FALHOU — ${msg(e)}`);
    }

    // 2. Alcance por XHR (transporte que o SDK usa em long polling)
    await new Promise<void>((resolve) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', 'https://firestore.googleapis.com/');
        x.timeout = 10_000;
        x.onloadend = () => {
          push(`XHR firestore.googleapis.com: HTTP ${x.status}`);
          resolve();
        };
        x.ontimeout = () => {
          push('XHR firestore.googleapis.com: TIMEOUT 10s');
          resolve();
        };
        x.send();
      } catch (e) {
        push(`XHR firestore.googleapis.com: FALHOU — ${msg(e)}`);
        resolve();
      }
    });

    // 3. Token de auth + leitura REST autenticada de um doc do usuário
    const user = auth.currentUser;
    if (!user) {
      push('auth: SEM usuário logado');
    } else {
      try {
        const token = await Promise.race([
          user.getIdToken(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('timeout 10s')), 10_000),
          ),
        ]);
        push('idToken: OK');
        try {
          const r = await fetch(
            `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/users/${user.uid}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          push(`REST doc users/uid: HTTP ${r.status}`);
        } catch (e) {
          push(`REST doc users/uid: FALHOU — ${msg(e)}`);
        }
      } catch (e) {
        push(`idToken: FALHOU — ${msg(e)}`);
      }

      // 4. Leitura real pelo SDK (o caminho que está "offline")
      try {
        const snap = await Promise.race([
          getDocs(query(collection(db, `users/${user.uid}/tasks`), limit(1))),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('TIMEOUT 15s')), 15_000),
          ),
        ]);
        push(`SDK getDocs tasks: OK (${snap.size} doc)`);
      } catch (e) {
        push(`SDK getDocs tasks: FALHOU — ${msg(e)}`);
      }
    }

    push('— fim —');
    setRunning(false);
  }

  useEffect(() => {
    if (!diagCache) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boxStyle: React.CSSProperties = {
    position: 'fixed',
    left: 8,
    bottom: 8,
    zIndex: 99999,
    fontSize: 11,
    fontFamily: 'monospace',
  };

  if (!open) {
    return (
      <button
        type="button"
        style={{ ...boxStyle, opacity: 0.65, padding: '4px 8px', borderRadius: 8 }}
        onClick={() => setOpen(true)}
      >
        🩺
      </button>
    );
  }

  return (
    <div
      style={{
        ...boxStyle,
        right: 8,
        maxHeight: '45vh',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.85)',
        color: '#9f9',
        padding: 10,
        borderRadius: 10,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <strong style={{ color: '#fff' }}>Diagnóstico Firestore</strong>
        <button type="button" onClick={() => void run()} disabled={running}>
          {running ? '…' : 'rodar de novo'}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          fechar
        </button>
      </div>
      {lines.length === 0 ? 'rodando…' : lines.join('\n')}
    </div>
  );
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

import { useEffect, useRef, useState } from 'react';

// Visualizador de HTML em TELA CHEIA dentro do próprio app — spec "ver HTMLs
// direto na mesma tela": antes disso o único jeito de abrir um .html do vault
// era baixar/abrir fora do app. Diferente do cartão inline de imagem/PDF
// (ObsidianFilePreviewCard/ObsidianGraphView), que fica com pointer-events
// desabilitado (só um "espiar", deixa o toque atravessar pro grafo), um HTML
// pode ser uma página interativa de verdade (formulário, checklist com JS) —
// por isso é um diálogo próprio, com toque normal dentro do iframe.
// `sandbox` roda scripts mas SEM `allow-same-origin`: o `blob:` URL vira uma
// origem opaca, então o HTML do usuário não consegue ler cookies/localStorage
// do próprio app nem alcançar a janela pai.
export function ObsidianHtmlViewerDialog({
  fileId,
  fileName,
  readFileBytes,
  onClose,
}: {
  fileId: string;
  fileName: string;
  readFileBytes: (fileId: string) => Promise<ArrayBuffer>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setStatus('loading');
    setError(null);
    setUrl(null);
    readFileBytes(fileId)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/html' }));
        setUrl(objectUrl);
        setStatus('loaded');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, readFileBytes]);

  // Gesto/botão de voltar do Android fecha o visualizador em vez de sair do
  // app (ou trocar de aba por baixo dele): empurra uma entrada de histórico
  // sintética assim que o diálogo monta e escuta `popstate`. Se o usuário
  // fechar pelo botão "Fechar" (não pelo back), o cleanup consome essa
  // entrada com `history.back()` — senão ela ficava "pendurada" e o próximo
  // back do usuário não faria nada visível (só desempilharia o fantasma).
  // `onClose` vive numa ref pra este efeito (que só roda uma vez, na
  // montagem — o diálogo inteiro é desmontado/remontado a cada abertura,
  // ver o `{htmlViewerNode && <...>}` condicional nos componentes que
  // renderizam isto) sempre chamar a versão mais recente.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    let closedViaBack = false;
    window.history.pushState({ obsidianHtmlViewer: true }, '');
    const onPopState = () => {
      closedViaBack = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (!closedViaBack) window.history.back();
    };
  }, []);

  return (
    <div
      className="obsidian-html-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizar ${fileName}`}
    >
      <div className="obsidian-html-viewer-toolbar">
        <span className="obsidian-html-viewer-title">{fileName}</span>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Fechar
        </button>
      </div>
      {status === 'loading' && <p className="muted">Carregando…</p>}
      {status === 'error' && <p className="error">{error}</p>}
      {status === 'loaded' && url && (
        <iframe
          className="obsidian-html-viewer-frame"
          src={url}
          title={fileName}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
        />
      )}
    </div>
  );
}

import { forwardRef, useEffect, useRef, useState } from 'react';
import { loadPdfDocument } from '../lib/pdf';

// Bytes já baixados nesta sessão, por id — evita rebaixar/re-renderizar se o
// usuário fechar e abrir o mesmo preview de novo. Escopo de módulo (não de
// componente): sobrevive a fechar/reabrir o preview, reseta só num reload da
// página — igual em espírito ao cache de PDF já usado na aba Leitura
// (src/lib/pdfCache.ts), só que em memória, sem persistência entre sessões.
const fileBytesCache = new Map<string, Promise<ArrayBuffer>>();

function loadFileBytes(
  fileId: string,
  readFileBytes: (fileId: string) => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  let cached = fileBytesCache.get(fileId);
  if (!cached) {
    cached = readFileBytes(fileId);
    fileBytesCache.set(fileId, cached);
    cached.catch(() => fileBytesCache.delete(fileId));
  }
  return cached;
}

// Preview de imagem/PDF a partir do grafo (mesmo mecanismo de cartão inline
// de `GrafosNoteGraphCard`, ver GrafosGraphView.tsx) — sem edição, só
// visualização. PDF usa o mesmo pdf.js já empacotado pra aba Leitura
// (src/lib/pdf.ts): um `<embed>`/`<iframe>` apontando pro blob não renderiza
// PDF de verdade no WebView do Android, então a página é desenhada num
// `<canvas>` como a Leitura já faz.
export const GrafosFilePreviewCard = forwardRef<
  HTMLDivElement,
  { fileId: string; mimeType: string; readFileBytes: (fileId: string) => Promise<ArrayBuffer> }
>(function GrafosFilePreviewCard({ fileId, mimeType, readFileBytes }, ref) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setBytes(null);
    loadFileBytes(fileId, readFileBytes)
      .then((data) => {
        if (cancelled) return;
        setBytes(data);
        setStatus('loaded');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, readFileBytes]);

  const isImage = mimeType.startsWith('image/');

  return (
    <div ref={ref} className="grafos-note-graph-card grafos-file-preview-card" role="group" aria-label="Preview de arquivo">
      {status === 'loading' && <p className="muted">Carregando…</p>}
      {status === 'error' && <p className="error">{error}</p>}
      {status === 'loaded' && bytes && (isImage ? <GrafosImagePreview bytes={bytes} mimeType={mimeType} /> : <GrafosPdfPagePreview bytes={bytes} />)}
    </div>
  );
});

function GrafosImagePreview({ bytes, mimeType }: { bytes: ArrayBuffer; mimeType: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytes, mimeType]);

  if (!url) return null;
  return <img src={url} alt="" />;
}

// Resolução fixa de renderização (independente do zoom AO VIVO do grafo) —
// o canvas escala visualmente via CSS (width:100%/height:auto, igual uma
// imagem), sem precisar re-renderizar o PDF a cada frame de pan/zoom.
const PDF_RENDER_WIDTH = 900;

function GrafosPdfPagePreview({ bytes }: { bytes: ArrayBuffer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const doc = await loadPdfDocument(bytes);
        const page = await doc.getPage(1);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = PDF_RENDER_WIDTH / unscaled.width;
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (error) return <p className="error">{error}</p>;
  return <canvas ref={canvasRef} />;
}

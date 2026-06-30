import { useEffect, useRef, useState } from 'react';
import type { ReadingItem } from '../types';
import { getCachedPdf } from '../lib/pdfCache';
import { loadPdfDocument } from '../lib/pdf';

const STATUS_LABEL: Record<ReadingItem['readingStatus'], string> = {
  'to-read': 'A ler',
  reading: 'Lendo',
  read: 'Lido',
};

// Card da estante. A capa é a 1ª página do PDF renderizada — porém só quando os
// bytes já estão no cache local, para não disparar download de todos os PDFs ao
// abrir a estante. Sem cache, mostra um placeholder com o título.
export function ReadingCard({
  item,
  onOpen,
  onEditMetadata,
}: {
  item: ReadingItem;
  onOpen: () => void;
  onEditMetadata: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasThumb, setHasThumb] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bytes = await getCachedPdf(item.driveFileId);
      if (!bytes || cancelled) return;
      try {
        const doc = await loadPdfDocument(bytes);
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        const targetW = 220;
        const scale = targetW / viewport.width;
        const vp = page.getViewport({ scale });
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (!cancelled) setHasThumb(true);
      } catch {
        // ignora — fica no placeholder
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.driveFileId]);

  return (
    <article className={`reading-card status-${item.readingStatus}`}>
      <button
        type="button"
        className="reading-card-cover"
        onClick={onOpen}
        aria-label={`Abrir ${item.title}`}
      >
        <canvas
          ref={canvasRef}
          className="reading-card-thumb"
          style={{ display: hasThumb ? 'block' : 'none' }}
        />
        {!hasThumb && (
          <span className="reading-card-cover-placeholder" aria-hidden="true">
            📄
          </span>
        )}
        <span className={`reading-card-badge badge-${item.readingStatus}`}>
          {STATUS_LABEL[item.readingStatus]}
        </span>
      </button>
      <div className="reading-card-body">
        <h3 className="reading-card-title" title={item.title}>
          {item.title || '(sem título)'}
        </h3>
        {item.authors.length > 0 && (
          <p className="reading-card-authors">{item.authors.join(', ')}</p>
        )}
        {(item.year || item.publication) && (
          <p className="reading-card-pub">
            {[item.publication, item.year].filter(Boolean).join(' · ')}
          </p>
        )}
        {item.tags.length > 0 && (
          <div className="reading-card-tags">
            {item.tags.map((t) => (
              <span key={t} className="reading-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <button type="button" className="reading-card-meta-btn" onClick={onEditMetadata}>
          Metadados
        </button>
      </div>
    </article>
  );
}

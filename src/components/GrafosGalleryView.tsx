import { useEffect, useMemo, useRef, useState } from 'react';
import {
  allTagsFrom,
  filterImagesByTags,
  groupImagesByMonth,
  onlyImages,
  parseTags,
} from '../lib/grafosGallery';
import type { DriveNode } from '../lib/grafosNode';
import type { useGrafosVault } from '../lib/grafosTree';

type Vault = ReturnType<typeof useGrafosVault>;

// Bytes de thumbnail já baixados nesta sessão, por id — mesma ideia do cache
// de GrafosFilePreviewCard.tsx (evita rebaixar ao rolar pra cima/baixo), só
// que aqui a lista pode ter centenas de imagens, então cada thumbnail só
// entra nesse cache quando de fato entra na viewport (ver useInView abaixo).
const thumbBytesCache = new Map<string, Promise<ArrayBuffer>>();

function loadThumbBytes(
  fileId: string,
  readFilePreview: (fileId: string) => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  let cached = thumbBytesCache.get(fileId);
  if (!cached) {
    cached = readFilePreview(fileId);
    thumbBytesCache.set(fileId, cached);
    cached.catch(() => thumbBytesCache.delete(fileId));
  }
  return cached;
}

// Só dispara o download da imagem quando o card entra na viewport — uma
// galeria com centenas de fotos não pode baixar tudo de uma vez ao abrir a
// aba (ver comentário do cache acima).
function useInView<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  return [ref, inView];
}

export function GrafosGalleryView({ vault }: { vault: Vault }) {
  const [images, setImages] = useState<DriveNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeImage, setActiveImage] = useState<DriveNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImages(null);
    setError(null);
    vault
      .loadGalleryImages()
      .then((loaded) => {
        if (!cancelled) setImages(onlyImages(loaded));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vault]);

  const allTags = useMemo(() => allTagsFrom(images ?? []), [images]);
  const filtered = useMemo(() => filterImagesByTags(images ?? [], selectedTags), [images, selectedTags]);
  const groups = useMemo(() => groupImagesByMonth(filtered), [filtered]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Atualização otimista local após salvar tags — evita recarregar a
  // galeria inteira do Drive só pra refletir uma edição de tags.
  function applyTagsLocally(fileId: string, tags: string[]) {
    const nextProperties = (prev: Record<string, string> | undefined) => ({
      ...prev,
      tags: tags.join(','),
    });
    setImages((prev) => (prev ? prev.map((img) => (img.id === fileId ? { ...img, properties: nextProperties(img.properties) } : img)) : prev));
    setActiveImage((prev) => (prev && prev.id === fileId ? { ...prev, properties: nextProperties(prev.properties) } : prev));
  }

  if (error) return <p className="error">{error}</p>;
  if (!images) return <p className="muted">Carregando galeria…</p>;
  if (images.length === 0) return <p className="muted">Nenhuma imagem encontrada no Drive.</p>;

  return (
    <div className="grafos-gallery">
      {allTags.length > 0 && (
        <div className="grafos-gallery-tag-filter" role="group" aria-label="Filtrar por tag">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={
                selectedTags.includes(tag)
                  ? 'grafos-gallery-tag-chip grafos-gallery-tag-chip--active'
                  : 'grafos-gallery-tag-chip'
              }
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="muted">Nenhuma imagem com essas tags.</p>
      ) : (
        <div className="grafos-gallery-timeline">
          {groups.map((group) => (
            <section key={group.key || 'sem-data'} className="grafos-gallery-group">
              <h3 className="grafos-gallery-group-label">{group.label}</h3>
              <div className="grafos-gallery-grid">
                {group.images.map((image) => (
                  <GrafosGalleryThumb
                    key={image.id}
                    image={image}
                    readFilePreview={vault.readFilePreview}
                    onClick={() => setActiveImage(image)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {activeImage && (
        <GrafosGalleryDetail
          image={activeImage}
          readFilePreview={vault.readFilePreview}
          onClose={() => setActiveImage(null)}
          onSaveTags={(tags) => {
            const fileId = activeImage.id;
            void vault.setImageTags(fileId, tags).then(() => applyTagsLocally(fileId, tags));
          }}
        />
      )}
    </div>
  );
}

function GrafosGalleryThumb({
  image,
  readFilePreview,
  onClick,
}: {
  image: DriveNode;
  readFilePreview: (fileId: string) => Promise<ArrayBuffer>;
  onClick: () => void;
}) {
  const [ref, inView] = useInView<HTMLButtonElement>();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    loadThumbBytes(image.id, readFilePreview).then((bytes) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [inView, image.id, image.mimeType, readFilePreview]);

  const tags = parseTags(image.properties);

  return (
    <button
      ref={ref}
      type="button"
      className="grafos-gallery-thumb"
      onClick={onClick}
      title={image.name}
      aria-label={image.name}
    >
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="grafos-gallery-thumb-placeholder" />}
      {tags.length > 0 && (
        <span className="grafos-gallery-thumb-tag-count">{tags.length}</span>
      )}
    </button>
  );
}

function GrafosGalleryDetail({
  image,
  readFilePreview,
  onClose,
  onSaveTags,
}: {
  image: DriveNode;
  readFilePreview: (fileId: string) => Promise<ArrayBuffer>;
  onClose: () => void;
  onSaveTags: (tags: string[]) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(() => parseTags(image.properties));

  useEffect(() => {
    setTags(parseTags(image.properties));
  }, [image.id, image.properties]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    loadThumbBytes(image.id, readFilePreview).then((bytes) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.id, image.mimeType, readFilePreview]);

  function addTag() {
    const next = tagInput.trim();
    if (!next || tags.includes(next)) {
      setTagInput('');
      return;
    }
    const updated = [...tags, next];
    setTags(updated);
    setTagInput('');
    onSaveTags(updated);
  }

  function removeTag(tag: string) {
    const updated = tags.filter((t) => t !== tag);
    setTags(updated);
    onSaveTags(updated);
  }

  return (
    <div className="grafos-gallery-detail-overlay" role="dialog" aria-label="Detalhe da imagem">
      <button type="button" className="grafos-html-viewer-close-fab" onClick={onClose} aria-label="Fechar">
        ×
      </button>
      <div className="grafos-gallery-detail-pane">
        <div className="grafos-gallery-detail-image">
          {url ? <img src={url} alt="" /> : <p className="muted">Carregando…</p>}
        </div>
        <p className="grafos-gallery-detail-name">{image.name}</p>
        <div className="grafos-gallery-tag-editor">
          <div className="grafos-gallery-tag-filter">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="grafos-gallery-tag-chip grafos-gallery-tag-chip--removable"
                onClick={() => removeTag(tag)}
                title="Remover tag"
              >
                {tag} ×
              </button>
            ))}
          </div>
          <form
            className="grafos-gallery-tag-form"
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
          >
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Nova tag…"
              aria-label="Nova tag"
            />
            <button type="submit">Adicionar</button>
          </form>
        </div>
      </div>
    </div>
  );
}

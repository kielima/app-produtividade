import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { subscribeToResources } from '../repositories/resourcesRepo';
import type { Resource } from '../types';

interface ResourcesValue {
  resources: Resource[];
  byId: Record<string, Resource>;
  loaded: boolean;
}

const EMPTY: ResourcesValue = { resources: [], byId: {}, loaded: false };

const ResourcesContext = createContext<ResourcesValue>(EMPTY);

/**
 * Assina os recursos (pessoas/IA que recebem tarefas) uma vez só, no topo do
 * app: o avatar aparece em todo card de tarefa, e cada card buscar a lista
 * por conta própria abriria dezenas de canais Realtime.
 */
export function ResourcesProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    return subscribeToResources(
      uid,
      (next) => {
        setResources(next);
        setLoaded(true);
      },
      // Sem a tabela (migration não aplicada) os cards só ficam sem avatar.
      (err) => console.error('Falha ao carregar recursos', err),
    );
  }, [uid]);

  const value = useMemo<ResourcesValue>(
    () => ({
      resources,
      byId: Object.fromEntries(resources.map((r) => [r.id, r])),
      loaded,
    }),
    [resources, loaded],
  );

  return <ResourcesContext.Provider value={value}>{children}</ResourcesContext.Provider>;
}

export function useResources(): ResourcesValue {
  return useContext(ResourcesContext);
}

/**
 * Resolve o `foto` guardado no banco para algo que o <img> aceita: data URL e
 * http(s) passam direto; um caminho relativo (asset público, ex.:
 * 'recursos/claude.svg') ganha o BASE_URL do build, que no APK é a raiz do
 * WebView e no site é a raiz do Hosting.
 */
export function resourcePhotoSrc(foto: string | null | undefined): string | null {
  if (!foto) return null;
  if (/^(data:|https?:|blob:)/.test(foto)) return foto;
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.replace(/\/$/, '')}/${foto.replace(/^\//, '')}`;
}

export function resourceInitial(nome: string): string {
  return (nome.trim().charAt(0) || '?').toUpperCase();
}

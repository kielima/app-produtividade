import { forwardRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteContentState } from '../lib/grafosTreeState';

// "Espiar" uma nota a partir do grafo — o nó (círculo) da nota em preview é
// substituído por este cartão, desenhado NO LUGAR do nó, não numa janela
// separada. `GrafosGraphView` é quem controla posição/tamanho (via `style`
// imperativo no elemento cujo ref é `ref`, sincronizado a cada frame com o
// zoom/pan do grafo) — este componente só cuida do conteúdo.
//
// `pointer-events: none` no cartão (definido no CSS) deixa gestos de
// toque atravessarem pro canvas por baixo, que é quem trata pan/zoom via
// d3-zoom — por isso não dá pra selecionar o texto aqui; só os botões de
// ação (que têm `pointer-events: auto` próprio) recebem toque.
export const GrafosNoteGraphCard = forwardRef<
  HTMLDivElement,
  { note: NoteContentState | undefined }
>(function GrafosNoteGraphCard({ note }, ref) {
  return (
    <div ref={ref} className="grafos-note-graph-card" role="group" aria-label="Preview de nota">
      {(!note || note.status === 'loading') && <p className="muted">Carregando…</p>}
      {note?.status === 'error' && <p className="error">{note.error}</p>}
      {note && (note.status === 'loaded' || note.status === 'saving') && (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content || '(nota vazia)'}</ReactMarkdown>
      )}
    </div>
  );
});

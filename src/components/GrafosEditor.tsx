import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { wikilinkHighlightExtension } from '../lib/grafosWikilinkHighlight';
import { parseWikilinks, stripMdExtension } from '../lib/grafosWikilink';
import { driveIconKind } from '../lib/driveFileIcons';
import type { DriveNode } from '../lib/grafosNode';

// Detecta `[[` ainda não fechado antes do cursor — dispara o autocomplete
// (spec item 5). `matchBefore` já garante que isto só casa na mesma linha.
const WIKILINK_TRIGGER_RE = /\[\[([^\]\n]*)$/;

// Nome em português de cada categoria de arquivo, usado como `detail` na
// lista de sugestões (CM6 renderiza texto simples ali, não ícones SVG).
const KIND_LABEL: Record<ReturnType<typeof driveIconKind>, string> = {
  folder: 'pasta',
  markdown: 'nota',
  doc: 'doc',
  sheet: 'planilha',
  slide: 'slides',
  pdf: 'pdf',
  image: 'imagem',
  html: 'html',
  file: 'arquivo',
};

// Fábrica da fonte de autocomplete: um pequeno debounce feito com um
// contador de requisição (a busca real vem da API do Drive — não faz sentido
// disparar uma chamada por tecla). Pastas não entram como sugestão: um
// wikilink aponta pra uma nota ou arquivo, não pra uma pasta.
function createWikilinkCompletionSource(searchNotes: (query: string) => Promise<DriveNode[]>) {
  let requestId = 0;
  return async function source(context: CompletionContext): Promise<CompletionResult | null> {
    const match = context.matchBefore(WIKILINK_TRIGGER_RE);
    if (!match) return null;
    const query = match.text.slice(2);
    if (!query.trim() && !context.explicit) return null;

    const myRequestId = ++requestId;
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (myRequestId !== requestId) return null;

    let nodes: DriveNode[];
    try {
      nodes = await searchNotes(query);
    } catch {
      return null;
    }
    if (myRequestId !== requestId) return null;

    return {
      from: match.from + 2,
      options: nodes
        .filter((node) => !node.isFolder)
        .map((node) => {
          const kind = driveIconKind(node);
          return {
            label: stripMdExtension(node.name),
            detail: KIND_LABEL[kind],
            type: kind,
            apply: `${stripMdExtension(node.name)}]]`,
          };
        }),
      validFor: /^[^\]]*$/,
    };
  };
}

// Wrapper React do CodeMirror 6 — construído uma vez por `fileId` montado,
// desmontado ao trocar de nota. Mudanças externas de conteúdo (`value`) só
// são empurradas pro editor quando `resetKey` muda (ex.: depois de resolver
// um conflito escolhendo "usar a do Drive"), nunca a cada re-render do pai,
// senão o cursor pularia enquanto o usuário digita.
export function GrafosEditor({
  value,
  resetKey,
  onChange,
  onManualSave,
  onSearchNotes,
  onNavigateWikilink,
}: {
  value: string;
  resetKey: string;
  onChange: (value: string) => void;
  onManualSave: () => void;
  onSearchNotes: (query: string) => Promise<DriveNode[]>;
  onNavigateWikilink: (target: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onManualSaveRef = useRef(onManualSave);
  onManualSaveRef.current = onManualSave;
  const onSearchNotesRef = useRef(onSearchNotes);
  onSearchNotesRef.current = onSearchNotes;
  const onNavigateWikilinkRef = useRef(onNavigateWikilink);
  onNavigateWikilinkRef.current = onNavigateWikilink;

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onManualSaveRef.current();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown(),
        wikilinkHighlightExtension,
        autocompletion({
          override: [createWikilinkCompletionSource((query) => onSearchNotesRef.current(query))],
        }),
        // Ctrl/Cmd+clique num wikilink navega pra nota; clique simples só
        // move o cursor (deixa livre editar o texto dentro dos colchetes).
        EditorView.domEventHandlers({
          click(event, view) {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            const link = parseWikilinks(view.state.doc.toString()).find(
              (l) => pos >= l.from && pos <= l.to,
            );
            if (!link) return false;
            event.preventDefault();
            onNavigateWikilinkRef.current(link.target);
            return true;
          },
        }),
        placeholderExt('Comece a escrever…'),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // resetKey força reconstruir o editor com o conteúdo novo (troca de nota,
    // ou reload após resolver conflito) sem interferir na digitação normal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return <div className="grafos-editor" ref={containerRef} />;
}

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { wikilinkHighlightExtension } from '../lib/obsidianWikilinkHighlight';

// Wrapper React do CodeMirror 6 — construído uma vez por `fileId` montado,
// desmontado ao trocar de nota. Mudanças externas de conteúdo (`value`) só
// são empurradas pro editor quando `resetKey` muda (ex.: depois de resolver
// um conflito escolhendo "usar a do Drive"), nunca a cada re-render do pai,
// senão o cursor pularia enquanto o usuário digita.
export function ObsidianEditor({
  value,
  resetKey,
  onChange,
  onManualSave,
}: {
  value: string;
  resetKey: string;
  onChange: (value: string) => void;
  onManualSave: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onManualSaveRef = useRef(onManualSave);
  onManualSaveRef.current = onManualSave;

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

  return <div className="obsidian-editor" ref={containerRef} />;
}

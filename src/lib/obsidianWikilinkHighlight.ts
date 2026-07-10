import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, EditorView } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { parseWikilinks } from './obsidianWikilink';

// Só o destaque visual de `[[wikilinks]]` — a sintaxe (alvo/alias/cabeçalho)
// mora em obsidianWikilink.ts, reaproveitada aqui só para gerar os ranges das
// decorações. Clique-para-navegar fica em ObsidianEditor.tsx (Fase 2), em
// cima dos mesmos ranges.

const wikilinkMark = Decoration.mark({ class: 'cm-obsidian-wikilink' });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  for (const link of parseWikilinks(text)) {
    builder.add(link.from, link.to, wikilinkMark);
  }
  return builder.finish();
}

export const wikilinkHighlightExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

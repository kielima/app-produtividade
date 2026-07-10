import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, EditorView } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Só o destaque visual de `[[wikilinks]]` — sem navegação/autocomplete
// (Fase 2). Fica aqui, isolado do parsing de backlinks, pra Fase 2 estender
// (clique pra navegar, autocomplete) em cima de uma decoração que já existe,
// em vez de retrofitar highlighting num editor já em produção.

export type WikilinkRange = { from: number; to: number };

const WIKILINK_RE = /\[\[[^\]\n]+\]\]/g;

// Função pura — testável sem montar um EditorView real.
export function extractWikilinkRanges(text: string): WikilinkRange[] {
  const ranges: WikilinkRange[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    if (match.index == null) continue;
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

const wikilinkMark = Decoration.mark({ class: 'cm-obsidian-wikilink' });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  for (const range of extractWikilinkRanges(text)) {
    builder.add(range.from, range.to, wikilinkMark);
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

import { useState } from 'react';
import { normalizeTag, normalizeTags, parseTagsInput } from '../lib/tags';
import TrashIcon from './TrashIcon';

export function TagsEditor({
  tags,
  onChange,
  suggestions = [],
  placeholder = 'adicionar tag…',
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const currentSet = new Set(tags.map((t) => normalizeTag(t)));
  const filteredSuggestions = suggestions
    .filter((s) => !currentSet.has(s))
    .filter((s) => (draft ? s.includes(normalizeTag(draft)) : true))
    .slice(0, 8);

  function commitDraft() {
    const parsed = parseTagsInput(draft);
    if (parsed.length === 0) {
      setDraft('');
      return;
    }
    const next = normalizeTags([...tags, ...parsed]);
    setDraft('');
    if (next.length !== tags.length || next.some((t, i) => t !== tags[i])) {
      onChange(next);
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function addSuggestion(tag: string) {
    const next = normalizeTags([...tags, tag]);
    if (next.length !== tags.length) onChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="tags-editor">
      <div className="tags-editor-row">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            <span className="tag-chip-label">{tag}</span>
            <button
              type="button"
              className="tag-chip-remove"
              onClick={() => removeTag(tag)}
              aria-label={`remover tag ${tag}`}
              title="remover"
            >
              <TrashIcon size={14} />
            </button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          placeholder={tags.length === 0 ? placeholder : ''}
          aria-label="nova tag"
        />
      </div>
      {filteredSuggestions.length > 0 && (
        <div className="tags-editor-suggestions" aria-label="sugestões de tags">
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="tag-chip tag-chip-suggestion"
              onClick={() => addSuggestion(s)}
              title={`adicionar tag ${s}`}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

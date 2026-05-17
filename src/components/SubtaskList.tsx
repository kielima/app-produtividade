import { useState } from 'react';
import type { Subtask } from '../types';
import { InlineEdit } from './InlineEdit';

export function SubtaskList({
  subtasks,
  onChange,
}: {
  subtasks: Subtask[];
  onChange: (next: Subtask[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function toggle(idx: number) {
    onChange(subtasks.map((s, i) => (i === idx ? { ...s, checked: !s.checked } : s)));
  }

  function remove(idx: number) {
    onChange(subtasks.filter((_, i) => i !== idx));
  }

  function rename(idx: number, text: string) {
    if (!text) {
      remove(idx);
      return;
    }
    onChange(subtasks.map((s, i) => (i === idx ? { ...s, text } : s)));
  }

  function add() {
    const t = draft.trim();
    if (!t) {
      setAdding(false);
      setDraft('');
      return;
    }
    onChange([...subtasks, { text: t, checked: false }]);
    setDraft('');
    setAdding(false);
  }

  return (
    <ul className="subtasks">
      {subtasks.map((s, i) => (
        <li key={i} className={s.checked ? 'done' : ''}>
          <input
            type="checkbox"
            checked={s.checked}
            onChange={() => toggle(i)}
            aria-label="alternar subtarefa"
          />
          <InlineEdit value={s.text} onSave={(v) => rename(i, v)} className="subtask-text" />
          <button
            type="button"
            className="icon-btn"
            style={{ fontSize: '24px' }}
            onClick={() => remove(i)}
            aria-label="remover subtarefa"
          >
            ×
          </button>
        </li>
      ))}
      {adding ? (
        <li className="subtask-add-row">
          <input
            type="text"
            className="inline-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            placeholder="Nova subtarefa…"
            autoFocus
          />
        </li>
      ) : (
        <li>
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            + adicionar subtarefa
          </button>
        </li>
      )}
    </ul>
  );
}

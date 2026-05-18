import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownNote({
  value,
  onSave,
  placeholder = '(sem nota)',
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      autoResize(el);
    }
  }, [editing]);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        className="markdown-note-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          autoResize(e.target);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
        }}
        placeholder={placeholder}
        rows={6}
        aria-label="editar nota"
      />
    );
  }

  if (!value) {
    return (
      <p
        className="markdown-note-empty"
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setEditing(true); }}
        aria-label="editar nota"
      >
        {placeholder}
      </p>
    );
  }

  return (
    <div
      className="markdown-note-preview"
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setEditing(true); }}
      aria-label="editar nota"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {value}
      </ReactMarkdown>
    </div>
  );
}

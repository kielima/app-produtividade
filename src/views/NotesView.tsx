import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NewNoteFab } from '../components/NewNoteFab';
import { useNoteNavigation } from '../lib/noteNavigation';
import { normalizeForSearch } from '../lib/searchNormalize';
import type { Note, Project } from '../types';

const HIDDEN_BY_DEFAULT_TAG = 'porno';

function NoteCard({
  note,
  project,
  onClick,
}: {
  note: Note;
  project?: Project;
  onClick: () => void;
}) {
  const hasItems = note.items.length > 0;
  const checkedCount = note.items.filter((i) => i.checked).length;

  return (
    <article
      className="note-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      style={note.color ? { background: note.color, borderColor: 'transparent' } : undefined}
    >
      <p className="note-card-title">
        {note.pinned && (
          <svg
            className="note-card-pin"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="fixada"
          >
            <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
          </svg>
        )}
        {note.title || <span className="muted">(sem título)</span>}
      </p>
      {note.note && (
        <div className="note-card-preview markdown-note-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.note}</ReactMarkdown>
        </div>
      )}
      {hasItems && (
        <p className="note-card-items muted">
          Lista: {checkedCount}/{note.items.length}
        </p>
      )}
      <div className="note-card-footer">
        {project && (
          <span className="note-card-project-badge" title={project.name}>
            {project.name}
          </span>
        )}
        {note.tags.length > 0 && (
          <div className="note-card-tags">
            {note.tags.map((tag) => (
              <span key={tag} className="tag-chip tag-chip-static">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function NotesView({
  uid,
  notes,
  selectedTags,
  searchQuery,
  projectFilter,
  projects = [],
}: {
  uid: string;
  notes: Note[];
  selectedTags: string[];
  searchQuery: string;
  projectFilter?: string | null;
  projects?: Project[];
}) {
  const { openNote } = useNoteNavigation();

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const filteredNotes = useMemo(() => {
    const q = normalizeForSearch(searchQuery.trim());
    const required = selectedTags.length > 0 ? new Set(selectedTags) : null;
    const hideHidden = !required || !required.has(HIDDEN_BY_DEFAULT_TAG);
    return notes.filter((n) => {
      if (hideHidden && n.tags.includes(HIDDEN_BY_DEFAULT_TAG)) return false;
      if (required) {
        const noteTags = new Set(n.tags);
        for (const t of required) if (!noteTags.has(t)) return false;
      }
      if (projectFilter) {
        if (n.projectId !== projectFilter) return false;
      }
      if (q) {
        const haystack = normalizeForSearch(
          [n.title, n.note, ...n.items.map((i) => i.text), ...n.tags].join('\n'),
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [notes, selectedTags, searchQuery, projectFilter]);

  const hasSearch = searchQuery.trim().length > 0;
  const pinnedNotes = filteredNotes.filter((n) => n.pinned);
  const otherNotes = filteredNotes.filter((n) => !n.pinned);
  const hasPinned = pinnedNotes.length > 0;
  const hasOthers = otherNotes.length > 0;

  return (
    <>
      {filteredNotes.length === 0 ? (
        <p className="muted notes-empty">
          {notes.length === 0
            ? 'Nenhuma anotação ainda. Toque em + para criar.'
            : hasSearch
              ? 'Nenhuma anotação corresponde à pesquisa.'
              : projectFilter
                ? 'Nenhuma anotação associada a este projeto.'
                : 'Nenhuma anotação corresponde às tags selecionadas.'}
        </p>
      ) : (
        <>
          {hasPinned && (
            <>
              <h2 className="note-section-heading">Fixadas</h2>
              <div className="note-list">
                {pinnedNotes.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    project={n.projectId ? projectMap.get(n.projectId) : undefined}
                    onClick={() => openNote(n.id)}
                  />
                ))}
              </div>
            </>
          )}
          {hasOthers && (
            <>
              {hasPinned && <h2 className="note-section-heading">Outras</h2>}
              <div className="note-list">
                {otherNotes.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    project={n.projectId ? projectMap.get(n.projectId) : undefined}
                    onClick={() => openNote(n.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <NewNoteFab uid={uid} />
    </>
  );
}

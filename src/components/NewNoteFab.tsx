import { useState } from 'react';
import { useNoteNavigation } from '../lib/noteNavigation';
import { createNote } from '../repositories/notesRepo';

export function NewNoteFab({ uid }: { uid: string }) {
  const [creating, setCreating] = useState(false);
  const { openNote } = useNoteNavigation();

  async function handleClick() {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNote(uid);
      openNote(note.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <button
      type="button"
      className="fab"
      onClick={handleClick}
      disabled={creating}
      aria-label="adicionar anotação"
      title="adicionar anotação"
    >
      <span style={{ lineHeight: 0 }}>+</span>
    </button>
  );
}

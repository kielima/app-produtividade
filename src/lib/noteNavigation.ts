import { createContext, useContext } from 'react';

interface NoteNavigationContextValue {
  openNote: (noteId: string) => void;
}

export const NoteNavigationContext = createContext<NoteNavigationContextValue>({
  openNote: () => {},
});

export function useNoteNavigation() {
  return useContext(NoteNavigationContext);
}

import { createContext, useContext } from 'react';

interface ReadingNavigation {
  // Abre a aba Leitura direto no item indicado, com o PDF rolado/aberto na
  // página da anotação e um pulso visual sobre ela.
  openAnnotation: (itemId: string, annotationId: string) => void;
}

export const ReadingNavigationContext = createContext<ReadingNavigation | null>(null);

export function useReadingNavigation(): ReadingNavigation {
  const ctx = useContext(ReadingNavigationContext);
  if (!ctx) {
    throw new Error('useReadingNavigation must be used within ReadingNavigationContext');
  }
  return ctx;
}

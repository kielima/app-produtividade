import { useEffect, useRef } from 'react';

// Não existia nenhum utilitário de debounce no projeto — este hook cobre o
// autosave da aba Grafos (e pode ser reaproveitado por qualquer outro
// "salva um pouco depois de parar de digitar" no futuro, ex. autocomplete
// da Fase 2). `fn` sempre roda com a versão mais recente via ref, então o
// timer não precisa ser recriado a cada keystroke.
export function useDebouncedCallback(fn: () => void, delayMs: number, deps: unknown[]): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const timer = setTimeout(() => fnRef.current(), delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps]);
}

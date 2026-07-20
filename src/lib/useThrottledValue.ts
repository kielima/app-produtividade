import { useEffect, useRef, useState } from 'react';

// Não existia nenhum utilitário de throttle no projeto (só debounce, ver
// useDebouncedCallback.ts) — este hook cobre o caso e pode ser reaproveitado
// por qualquer outra fonte de mudanças muito frequentes no futuro.
//
// Throttle de VALOR (não de callback): devolve uma "amostra" de `value` que
// atualiza no máximo uma vez a cada `intervalMs`, mesmo que `value` mude com
// muito mais frequência que isso. Diferente de debounce (que só dispara
// depois de um período de silêncio — inútil aqui, porque a fonte que motivou
// este hook, o crawl eager do sistema solar em GrafosSolarSystemView.tsx,
// muda `vault.state` CONTINUAMENTE por um tempo longo; um debounce nunca
// dispararia até o crawl inteiro terminar), o throttle sempre converge pro
// valor mais recente dentro de `intervalMs`, mantendo a sensação de
// "atualizando ao vivo" sem recalcular a cada mudança individual.
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdateRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef(value);
  latestRef.current = value;

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    if (elapsed >= intervalMs) {
      lastUpdateRef.current = now;
      setThrottled(value);
      return;
    }
    // Já existe uma atualização agendada pro fim da janela atual — ela vai
    // pegar o valor mais recente (`latestRef.current`) quando disparar, não
    // precisa reagendar a cada mudança individual.
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastUpdateRef.current = Date.now();
      setThrottled(latestRef.current);
    }, intervalMs - elapsed);
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return throttled;
}

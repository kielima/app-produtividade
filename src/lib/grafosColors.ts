import { useEffect, useState } from 'react';

// Canvas 2D não lê variáveis CSS (`var(--x)`) diretamente — precisam ser
// resolvidas uma vez via `getComputedStyle` e recalculadas quando o tema
// claro/escuro muda. Extraído de GrafosGraphView.tsx para um módulo sem
// nenhum import de `react-force-graph-2d`, para que outras visualizações
// (ex. o sistema solar) possam reaproveitar a lógica de leitura de cor sem
// puxar a lib do grafo para o próprio bundle (quebraria o code-splitting).
export type CssVarReader = (name: string, fallback: string) => string;

export function resolveCssVars(): CssVarReader {
  const style = getComputedStyle(document.documentElement);
  return (name, fallback) => style.getPropertyValue(name).trim() || fallback;
}

// Hook genérico: `resolve` mapeia um leitor de variável CSS para a paleta
// específica de quem chama (formato livre — cada visualização tem seu
// próprio shape de cores). Recomputa sempre que o esquema claro/escuro do
// sistema muda. `resolve` deve ser uma referência estável (função de módulo,
// não recriada a cada render) — não entra nas deps do efeito, mesmo padrão
// de `useGraphColors` original.
export function useThemeColors<T>(resolve: (read: CssVarReader) => T): T {
  const [colors, setColors] = useState(() => resolve(resolveCssVars()));
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setColors(resolve(resolveCssVars()));
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return colors;
}

import { useEffect, useMemo } from 'react';

const COLORS = [
  '#f94144',
  '#f3722c',
  '#f8961e',
  '#f9c74f',
  '#90be6d',
  '#43aa8b',
  '#577590',
  '#ef476f',
];

/**
 * Chuva de confetes em CSS puro (sem dependências) usada como recompensa ao
 * concluir 100% da classificação. Renderiza um overlay fixo que não captura
 * cliques e se auto-desmonta após `duration`. Respeita prefers-reduced-motion
 * via CSS (os confetes ficam ocultos), mas o timer ainda limpa o estado.
 */
export default function Confetti({
  count = 90,
  duration = 3200,
  onDone,
}: {
  count?: number;
  duration?: number;
  onDone?: () => void;
}) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 0.6,
        fall: 2.2 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 240,
        rotate: Math.random() * 960 - 480,
        size: 6 + Math.random() * 7,
        round: Math.random() > 0.5,
      })),
    [count],
  );

  useEffect(() => {
    if (!onDone) return;
    const t = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(t);
  }, [duration, onDone]);

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              width: `${p.size}px`,
              height: `${p.size}px`,
              borderRadius: p.round ? '50%' : '2px',
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.fall}s`,
              '--confetti-drift': `${p.drift}px`,
              '--confetti-rotate': `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

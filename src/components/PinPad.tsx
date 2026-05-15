import { useEffect } from 'react';

export interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  length?: number;
  disabled?: boolean;
}

/**
 * Numpad customizado pra entrada de PIN.
 * Renderiza apenas a grade 3x3 + linha OK/0/⌫.
 * Os dots indicadores ficam por conta de quem consome — geralmente
 * próximos ao prompt, não ao pad (ver Login.tsx).
 * Suporta teclado físico via keydown listener.
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  length = 6,
  disabled = false,
}: PinPadProps) {
  function appendDigit(d: string) {
    if (disabled) return;
    if (value.length >= length) return;
    onChange(value + d);
  }

  function removeDigit() {
    if (disabled) return;
    onChange(value.slice(0, -1));
  }

  function trySubmit() {
    if (disabled) return;
    if (value.length !== length) return;
    onSubmit();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabled) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        removeDigit();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        trySubmit();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled]);

  const canSubmit = value.length === length && !disabled;

  return (
    <div className="pin-pad" role="group" aria-label="teclado numérico">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
        <button
          key={n}
          type="button"
          className="pin-key"
          onClick={() => appendDigit(String(n))}
          disabled={disabled || value.length >= length}
          aria-label={`dígito ${n}`}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="pin-key pin-key-ok"
        onClick={trySubmit}
        disabled={!canSubmit}
        aria-label="confirmar"
      >
        OK
      </button>
      <button
        type="button"
        className="pin-key"
        onClick={() => appendDigit('0')}
        disabled={disabled || value.length >= length}
        aria-label="dígito 0"
      >
        0
      </button>
      <button
        type="button"
        className="pin-key pin-key-back"
        onClick={removeDigit}
        disabled={disabled || value.length === 0}
        aria-label="apagar último dígito"
      >
        ⌫
      </button>
    </div>
  );
}

/**
 * Componente companheiro: dots indicadores. Separado do PinPad pra
 * permitir layouts onde os dots ficam perto do prompt e o pad embaixo.
 */
export function PinDots({ value, length = 6 }: { value: string; length?: number }) {
  return (
    <div
      className="pin-dots"
      role="status"
      aria-label={`${value.length} de ${length} dígitos`}
    >
      {Array.from({ length }).map((_, i) => (
        <span key={i} className={`pin-dot${i < value.length ? ' filled' : ''}`} />
      ))}
    </div>
  );
}

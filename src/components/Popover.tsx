import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Popover ancorado ao próprio trigger. Fecha em click-fora ou Escape.
 * Usado pelos pickers de MoSCoW/Modo/Esforço/Seção/Prazo.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
}: {
  trigger: (open: () => void, isOpen: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="popover-wrapper">
      {trigger(() => setOpen((v) => !v), open)}
      {open && (
        <div className={`popover-panel align-${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

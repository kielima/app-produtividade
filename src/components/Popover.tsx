import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Popover ancorado ao próprio trigger. Fecha em click-fora ou Escape.
 * Usado pelos pickers de MoSCoW/Modo/Esforço/Seção/Prazo.
 *
 * Após abrir, o painel é deslocado horizontalmente o mínimo necessário para
 * caber na viewport — o trigger (ex: badge "Adiar") pode acabar perto de
 * qualquer borda conforme a linha de badges quebra, então um `align` fixo não
 * basta para impedir que o menu vaze para fora da tela.
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
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Mantém o painel dentro da viewport: mede a posição real e aplica o menor
  // deslocamento horizontal que o traga de volta para dentro das margens.
  useLayoutEffect(() => {
    if (!open) return;
    const margin = 8;
    function clamp() {
      const panel = panelRef.current;
      if (!panel) return;
      panel.style.transform = '';
      const rect = panel.getBoundingClientRect();
      let shift = 0;
      if (rect.right > window.innerWidth - margin) {
        shift = window.innerWidth - margin - rect.right;
      }
      if (rect.left + shift < margin) {
        shift = margin - rect.left;
      }
      if (shift !== 0) panel.style.transform = `translateX(${shift}px)`;
    }
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [open]);

  return (
    <span ref={wrapperRef} className="popover-wrapper">
      {trigger(() => setOpen((v) => !v), open)}
      {open && (
        <div ref={panelRef} className={`popover-panel align-${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

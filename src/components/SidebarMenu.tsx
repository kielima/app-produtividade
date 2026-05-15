import { useEffect } from 'react';

export type MenuItem = {
  key: string;
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onSignOut: () => void;
};

export function SidebarMenu({ open, onClose, items, activeKey, onSelect, onSignOut }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={open ? 'sidebar-backdrop open' : 'sidebar-backdrop'}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={open ? 'sidebar open' : 'sidebar'}
        role="dialog"
        aria-modal="true"
        aria-label="Menu principal"
        aria-hidden={!open}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Fechar menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="seções principais">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activeKey === item.key ? 'sidebar-item active' : 'sidebar-item'}
              onClick={() => {
                onSelect(item.key);
                onClose();
              }}
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-item"
            onClick={() => {
              onSignOut();
              onClose();
            }}
          >
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}

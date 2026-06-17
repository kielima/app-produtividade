// Diálogo que mostra o log completo de novas funcionalidades lançadas em
// cada atualização do app. Aberto a partir do carimbo de data na tela de
// Configurações.

import { CHANGELOG, formatChangelogDate } from '../lib/changelog';

export function ChangelogDialog({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div
        className="share-dialog-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-dialog-title"
      >
        <h2 id="changelog-dialog-title">Novidades</h2>
        <p className="muted">
          Histórico das novas funções lançadas em cada atualização.
        </p>

        <ol className="changelog-list">
          {CHANGELOG.map((entry) => (
            <li key={entry.date} className="changelog-entry">
              <div className="changelog-entry-head">
                <time dateTime={entry.date} className="changelog-entry-date">
                  {formatChangelogDate(entry.date)}
                </time>
                {entry.version && (
                  <span className="changelog-entry-version">
                    {entry.version}
                  </span>
                )}
              </div>
              <strong className="changelog-entry-title">{entry.title}</strong>
              <ul className="changelog-entry-items">
                {entry.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <div className="share-dialog-actions">
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </>
  );
}

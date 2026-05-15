import { deleteSection, renameSection, setSectionMoscow } from '../repositories/sectionsRepo';
import type { MoSCoW, Section } from '../types';
import { InlineEdit } from './InlineEdit';
import { Popover } from './Popover';

const MOSCOW_LABEL: Record<MoSCoW, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  '': '—',
};

const MOSCOW_OPTS: MoSCoW[] = ['must', 'should', 'could', 'wont', ''];

export function SectionHeader({
  uid,
  section,
  taskCount,
}: {
  uid: string;
  section: Section;
  taskCount: number;
}) {
  async function rename(newName: string) {
    if (!newName || newName === section.name) return;
    await renameSection(uid, section.id, newName);
  }

  async function setMoscow(m: MoSCoW) {
    await setSectionMoscow(uid, section.id, m);
  }

  async function handleDelete() {
    const msg =
      taskCount > 0
        ? `Apagar a seção "${section.name}" e ${taskCount} tarefa(s) dentro dela?`
        : `Apagar a seção "${section.name}"?`;
    if (!window.confirm(msg)) return;
    await deleteSection(uid, section.id);
  }

  return (
    <header className="section-header">
      <InlineEdit value={section.name} onSave={rename} className="section-title" />
      <Popover
        trigger={(open) => (
          <button type="button" className={`badge moscow-${section.moscow}`} onClick={open}>
            {MOSCOW_LABEL[section.moscow]}
          </button>
        )}
      >
        {(close) => (
          <ul className="picker-list">
            {MOSCOW_OPTS.map((v) => (
              <li key={v}>
                <button
                  type="button"
                  className={v === section.moscow ? 'active' : ''}
                  onClick={() => {
                    setMoscow(v);
                    close();
                  }}
                >
                  {MOSCOW_LABEL[v]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      <span className="muted">{taskCount} tarefa{taskCount === 1 ? '' : 's'}</span>
      <button
        type="button"
        className="icon-btn danger"
        onClick={handleDelete}
        aria-label="deletar seção"
        title="apagar seção"
      >
        🗑
      </button>
    </header>
  );
}

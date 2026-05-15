import { useEffect, useMemo, useRef, useState } from 'react';
import { NewTaskInput } from '../components/NewTaskInput';
import { SectionHeader } from '../components/SectionHeader';
import { TaskCard } from '../components/TaskCard';
import { buildDependencyMap, isTaskBlocked } from '../lib/score';
import { createSection, subscribeToSections } from '../repositories/sectionsRepo';
import { archiveCompletedTasks, subscribeToTasks } from '../repositories/tasksRepo';
import type { MoSCoW, Section, Task } from '../types';

const MOSCOW_FILTERS: Array<{ value: MoSCoW | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'must', label: 'Must' },
  { value: 'should', label: 'Should' },
  { value: 'could', label: 'Could' },
  { value: 'wont', label: "Won't" },
];

export function ListView({ uid }: { uid: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [moscowFilter, setMoscowFilter] = useState<MoSCoW | 'all'>('all');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const archivedOnLoad = useRef(false);

  useEffect(() => {
    const unsubT = subscribeToTasks(uid, setTasks, (e) => setError(e.message));
    const unsubS = subscribeToSections(uid, setSections, (e) => setError(e.message));
    return () => {
      unsubT();
      unsubS();
    };
  }, [uid]);

  // Auto-archive uma vez por sessão: move tarefas marcadas pra completedTasks/.
  useEffect(() => {
    if (archivedOnLoad.current) return;
    archivedOnLoad.current = true;
    archiveCompletedTasks(uid)
      .then((n) => {
        if (n > 0) {
          setArchiveMsg(`${n} tarefa${n === 1 ? '' : 's'} arquivada${n === 1 ? '' : 's'}.`);
          setTimeout(() => setArchiveMsg(null), 4000);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [uid]);

  const sectionMap = useMemo(() => {
    const m: Record<string, Section> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const ctx = useMemo(
    () =>
      buildDependencyMap(
        tasks.map((task) => ({ task, section: sectionMap[task.section] ?? null })),
      ),
    [tasks, sectionMap],
  );

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (hideCompleted && t.checked) return false;
      if (sectionFilter !== 'all' && t.section !== sectionFilter) return false;
      if (moscowFilter !== 'all' && t.moscow !== moscowFilter) return false;
      return true;
    });
  }, [tasks, sectionFilter, moscowFilter, hideCompleted]);

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const t of filtered) {
      const key = t.section || '(sem seção)';
      (g[key] ??= []).push(t);
    }
    return g;
  }, [filtered]);

  // Seções visíveis: filtradas mas mantendo ordem do array `sections`
  const visibleSections = useMemo(() => {
    if (sectionFilter !== 'all') return sections.filter((s) => s.id === sectionFilter);
    return sections;
  }, [sections, sectionFilter]);

  async function handleArchiveNow() {
    const n = await archiveCompletedTasks(uid);
    setArchiveMsg(n > 0 ? `${n} tarefa(s) arquivada(s).` : 'Nada para arquivar.');
    setTimeout(() => setArchiveMsg(null), 4000);
  }

  async function handleAddSection() {
    const name = newSectionName.trim();
    if (!name) {
      setAddingSection(false);
      setNewSectionName('');
      return;
    }
    await createSection(uid, name, '', sections.length);
    setNewSectionName('');
    setAddingSection(false);
  }

  if (error) return <p className="error">Erro: {error}</p>;

  return (
    <section className="list-view">
      <header className="filters">
        <label>
          Seção:&nbsp;
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="all">Todas</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          MoSCoW:&nbsp;
          <select
            value={moscowFilter}
            onChange={(e) => setMoscowFilter(e.target.value as MoSCoW | 'all')}
          >
            {MOSCOW_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          &nbsp;ocultar concluídas
        </label>
        <span className="counter">
          {filtered.length} de {tasks.length}
        </span>
        <button type="button" className="btn-secondary" onClick={handleArchiveNow}>
          Arquivar concluídas
        </button>
      </header>

      {archiveMsg && <p className="toast">{archiveMsg}</p>}

      {visibleSections.length === 0 && tasks.length === 0 && (
        <p className="muted">
          Nada por aqui. Crie a primeira seção abaixo ou rode o script de migração.
        </p>
      )}

      {visibleSections.map((sec) => {
        const list = grouped[sec.id] ?? [];
        const totalInSection = tasks.filter((t) => t.section === sec.id).length;
        return (
          <div key={sec.id} className="section-group">
            <SectionHeader uid={uid} section={sec} taskCount={totalInSection} />
            <div className="task-list">
              {list.map((t) => (
                <TaskCard
                  key={t.id}
                  uid={uid}
                  task={t}
                  blocked={isTaskBlocked(t, ctx)}
                  sections={sections}
                  allTasks={tasks}
                />
              ))}
              <NewTaskInput uid={uid} sectionId={sec.id} />
            </div>
          </div>
        );
      })}

      <div className="add-section-row">
        {addingSection ? (
          <input
            type="text"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onBlur={handleAddSection}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSection();
              if (e.key === 'Escape') {
                setNewSectionName('');
                setAddingSection(false);
              }
            }}
            placeholder="Nome da nova seção…"
            autoFocus
            className="inline-edit-input"
          />
        ) : (
          <button type="button" className="link-btn" onClick={() => setAddingSection(true)}>
            + adicionar seção
          </button>
        )}
      </div>
    </section>
  );
}

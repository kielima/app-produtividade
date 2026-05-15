import { useEffect, useMemo, useState } from 'react';
import { subscribeToSections } from '../repositories/sectionsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import { buildDependencyMap, isTaskBlocked } from '../lib/score';
import { TaskCard } from '../components/TaskCard';
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

  useEffect(() => {
    const unsubT = subscribeToTasks(uid, setTasks, (e) => setError(e.message));
    const unsubS = subscribeToSections(uid, setSections, (e) => setError(e.message));
    return () => {
      unsubT();
      unsubS();
    };
  }, [uid]);

  const sectionMap = useMemo(() => {
    const m: Record<string, Section> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const ctx = useMemo(
    () =>
      buildDependencyMap(tasks.map((task) => ({ task, section: sectionMap[task.section] ?? null }))),
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
      </header>

      {Object.keys(grouped).length === 0 && (
        <p className="muted">Nada por aqui. Rode o script de migração ou crie uma tarefa.</p>
      )}

      {Object.entries(grouped).map(([sid, list]) => {
        const sec = sectionMap[sid];
        return (
          <div key={sid} className="section-group">
            <h2>{sec ? sec.name : sid}</h2>
            <div className="task-list">
              {list.map((t) => (
                <TaskCard key={t.id} task={t} blocked={isTaskBlocked(t, ctx)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

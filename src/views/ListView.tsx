import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { DraggableTaskCard } from '../components/DraggableTaskCard';
import { DroppableSection } from '../components/DroppableSection';
import { NewTaskInput } from '../components/NewTaskInput';
import { SectionHeader } from '../components/SectionHeader';
import { TaskCard } from '../components/TaskCard';
import { isTaskBlocked } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import { createProject } from '../repositories/projectsRepo';
import { archiveCompletedTasks } from '../repositories/tasksRepo';
import type { MoSCoW, Project, ScoreContext, Task } from '../types';

const MOSCOW_FILTERS: Array<{ value: MoSCoW | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'must', label: 'Must' },
  { value: 'should', label: 'Should' },
  { value: 'could', label: 'Could' },
  { value: 'wont', label: "Won't" },
];

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

export function ListView({
  uid,
  tasks,
  totalCount,
  projects,
  projectFilter,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  totalCount: number;
  projects: Project[];
  projectFilter: string;
  ctx: ScoreContext;
}) {
  const [moscowFilter, setMoscowFilter] = useState<MoSCoW | 'all'>('all');
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const taskMap = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  // Se o filtro global selecionou um projeto específico, mostra só ele
  // (mesmo Concluído/Cancelado). Senão, oculta os encerrados.
  const activeProjects = useMemo(() => {
    if (projectFilter) return projects.filter((p) => p.id === projectFilter);
    return projects.filter((p) => !isHiddenProject(p));
  }, [projects, projectFilter]);

  const filtered = useMemo(() => {
    const allowedIds = new Set(activeProjects.map((p) => p.id));
    return tasks.filter((t) => {
      if (!allowedIds.has(t.section)) return false;
      if (moscowFilter !== 'all' && t.moscow !== moscowFilter) return false;
      return true;
    });
  }, [tasks, activeProjects, moscowFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const t of filtered) {
      const key = t.section || '(sem projeto)';
      (g[key] ??= []).push(t);
    }
    return g;
  }, [filtered]);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    const taskId = String(e.active.id);
    const task = taskMap[taskId];
    if (!task || task.section === overId) return;
    await patchTask(uid, task, { section: overId });
  }

  async function handleArchiveNow() {
    const n = await archiveCompletedTasks(uid);
    setArchiveMsg(n > 0 ? `${n} tarefa(s) arquivada(s).` : 'Nada para arquivar.');
    setTimeout(() => setArchiveMsg(null), 4000);
  }

  async function handleAddProject() {
    const name = newProjectName.trim();
    if (!name) {
      setAddingProject(false);
      setNewProjectName('');
      return;
    }
    await createProject(uid, name, projects.length);
    setNewProjectName('');
    setAddingProject(false);
  }

  const activeTask = activeDragId ? taskMap[activeDragId] : null;

  return (
    <section className="list-view">
      <header className="filters">
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
        <span className="counter">
          {filtered.length} de {totalCount}
        </span>
        <button type="button" className="btn-secondary" onClick={handleArchiveNow}>
          Arquivar concluídas
        </button>
      </header>

      {archiveMsg && <p className="toast">{archiveMsg}</p>}

      {activeProjects.length === 0 && totalCount === 0 && (
        <p className="muted">
          Nada por aqui. Crie o primeiro projeto abaixo ou rode o script de migração.
        </p>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {activeProjects.map((proj) => {
          const list = grouped[proj.id] ?? [];
          const totalInProject = tasks.filter((t) => t.section === proj.id).length;
          return (
            <div key={proj.id} className="section-group">
              <SectionHeader uid={uid} project={proj} taskCount={totalInProject} />
              <DroppableSection id={proj.id}>
                <div className="task-list">
                  {list.map((t) => (
                    <DraggableTaskCard
                      key={t.id}
                      uid={uid}
                      task={t}
                      blocked={isTaskBlocked(t, ctx)}
                      projects={projects}
                      allTasks={tasks}
                    />
                  ))}
                  {list.length === 0 && (
                    <p className="drop-hint muted">solte aqui para mover</p>
                  )}
                  <NewTaskInput uid={uid} sectionId={proj.id} />
                </div>
              </DroppableSection>
            </div>
          );
        })}

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="drag-overlay">
              <TaskCard
                uid={uid}
                task={activeTask}
                blocked={isTaskBlocked(activeTask, ctx)}
                projects={projects}
                allTasks={tasks}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className="add-section-row">
        {addingProject ? (
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onBlur={handleAddProject}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddProject();
              if (e.key === 'Escape') {
                setNewProjectName('');
                setAddingProject(false);
              }
            }}
            placeholder="Nome do novo projeto…"
            autoFocus
            className="inline-edit-input"
          />
        ) : (
          <button type="button" className="link-btn" onClick={() => setAddingProject(true)}>
            + adicionar projeto
          </button>
        )}
      </div>
    </section>
  );
}

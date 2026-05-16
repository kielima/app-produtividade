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
import { calcScore, isTaskBlocked } from '../lib/score';
import { patchTask } from '../lib/taskMutations';
import { createProject } from '../repositories/projectsRepo';
import type { Project, ScoreContext, Task } from '../types';

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

/**
 * Visão Board: colunas horizontais lado a lado, uma por projeto ativo.
 * Tasks ordenadas por score descendente, bloqueadas empurradas pro fim
 * (mesma regra do renderBoard() do dashboard).
 */
export function BoardView({
  uid,
  tasks,
  projects,
  projectMap,
  ctx,
}: {
  uid: string;
  tasks: Task[];
  projects: Project[];
  projectMap: Record<string, Project>;
  ctx: ScoreContext;
}) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const taskMap = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  const activeProjects = useMemo(
    () => projects.filter((p) => !isHiddenProject(p)),
    [projects],
  );

  const tasksByProject = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (hideCompleted && t.checked) continue;
      (g[t.section] ??= []).push(t);
    }
    // Ordena cada coluna: bloqueadas no fim, depois por score desc.
    for (const proj of activeProjects) {
      const list = g[proj.id] ?? [];
      list.sort((a, b) => {
        const aBlk = isTaskBlocked(a, ctx) ? 1 : 0;
        const bBlk = isTaskBlocked(b, ctx) ? 1 : 0;
        if (aBlk !== bBlk) return aBlk - bBlk;
        return (
          calcScore(b, projectMap[b.section] ?? null, ctx) -
          calcScore(a, projectMap[a.section] ?? null, ctx)
        );
      });
      g[proj.id] = list;
    }
    return g;
  }, [tasks, activeProjects, projectMap, ctx, hideCompleted]);

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
    <section className="board-view">
      <header className="filters">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          &nbsp;ocultar concluídas
        </label>
        <span className="counter">
          {activeProjects.length} projeto{activeProjects.length === 1 ? '' : 's'}
        </span>
      </header>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board-columns">
          {activeProjects.map((proj) => {
            const list = tasksByProject[proj.id] ?? [];
            const totalInProject = tasks.filter((t) => t.section === proj.id).length;
            return (
              <div key={proj.id} className="board-column">
                <SectionHeader uid={uid} project={proj} taskCount={totalInProject} />
                <DroppableSection id={proj.id}>
                  <div className="task-list board-column-body">
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
                      <p className="drop-hint muted">solte aqui</p>
                    )}
                    <NewTaskInput uid={uid} sectionId={proj.id} />
                  </div>
                </DroppableSection>
              </div>
            );
          })}

          <div className="board-column board-add-column">
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
                placeholder="Nome do projeto…"
                autoFocus
                className="inline-edit-input"
              />
            ) : (
              <button
                type="button"
                className="board-add-btn"
                onClick={() => setAddingProject(true)}
              >
                + adicionar projeto
              </button>
            )}
          </div>
        </div>

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
    </section>
  );
}

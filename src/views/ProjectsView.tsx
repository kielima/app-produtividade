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
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '../components/ProjectCard';
import {
  isAllProjectStatuses,
  type ProjectFiltersState,
} from '../components/ProjectFiltersBar';
import { SortableProjectCard } from '../components/SortableProjectCard';
import {
  createProject,
  reorderProjects,
  subscribeToProjects,
} from '../repositories/projectsRepo';
import { subscribeToTasks } from '../repositories/tasksRepo';
import type { Project, Task } from '../types';

export function ProjectsView({
  uid,
  filters,
}: {
  uid: string;
  filters: ProjectFiltersState;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Ordem otimista local enquanto o batch persiste e o snapshot volta.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  useEffect(() => {
    const onErr = (e: Error) => setError(e.message);
    const unsubProjects = subscribeToProjects(uid, (next) => {
      setProjects(next);
      setLocalOrder(null);
    }, onErr);
    const unsubTasks = subscribeToTasks(uid, setTasks, onErr);
    return () => {
      unsubProjects();
      unsubTasks();
    };
  }, [uid]);

  const taskCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.section] = (counts[t.section] ?? 0) + 1;
    return counts;
  }, [tasks]);

  // Lista base já reordenada otimisticamente caso o usuário tenha arrastado.
  const orderedProjects = useMemo(() => {
    if (!localOrder) return projects;
    const byId: Record<string, Project> = {};
    for (const p of projects) byId[p.id] = p;
    const seen = new Set<string>();
    const ordered: Project[] = [];
    for (const id of localOrder) {
      const p = byId[id];
      if (p) {
        ordered.push(p);
        seen.add(id);
      }
    }
    // Anexa qualquer projeto novo que ainda não estava na ordem otimista.
    for (const p of projects) if (!seen.has(p.id)) ordered.push(p);
    return ordered;
  }, [projects, localOrder]);

  const reorderEnabled = isAllProjectStatuses(filters);
  const filtered = useMemo(
    () =>
      reorderEnabled
        ? orderedProjects
        : orderedProjects.filter((p) => filters.statusFilter.has(p.status)),
    [orderedProjects, filters, reorderEnabled],
  );

  const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const activeProject = useMemo(
    () => (activeDragId ? projects.find((p) => p.id === activeDragId) ?? null : null),
    [activeDragId, projects],
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    if (!overId || overId === activeId) return;
    const oldIndex = orderedProjects.findIndex((p) => p.id === activeId);
    const newIndex = orderedProjects.findIndex((p) => p.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedProjects, oldIndex, newIndex);
    const nextIds = next.map((p) => p.id);
    setLocalOrder(nextIds);
    try {
      await reorderProjects(uid, nextIds);
    } catch (err) {
      setError((err as Error).message);
      setLocalOrder(null);
    }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      setNewName('');
      return;
    }
    await createProject(uid, name, projects.length);
    setNewName('');
    setAdding(false);
  }

  if (error) return <p className="error">Erro: {error}</p>;

  return (
    <section className="projects-view">
      {filtered.length === 0 && (
        <p className="muted">
          {projects.length === 0
            ? 'Nenhum projeto. Crie o primeiro abaixo.'
            : 'Nenhum projeto para o filtro selecionado.'}
        </p>
      )}

      {!reorderEnabled && filtered.length > 0 && (
        <p className="muted reorder-hint">
          Para reordenar, limpe os filtros.
        </p>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={filteredIds} strategy={verticalListSortingStrategy}>
          <div className="project-list">
            {filtered.map((p) => (
              <SortableProjectCard
                key={p.id}
                project={p}
                taskCount={taskCountByProject[p.id] ?? 0}
                disabled={!reorderEnabled}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeProject && (
            <div className="drag-overlay">
              <ProjectCard
                project={activeProject}
                taskCount={taskCountByProject[activeProject.id] ?? 0}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {adding ? (
        <div className="add-section-row">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleAdd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') {
                setNewName('');
                setAdding(false);
              }
            }}
            placeholder="Nome do novo projeto…"
            autoFocus
            className="inline-edit-input"
          />
        </div>
      ) : (
        <button
          type="button"
          className="fab"
          onClick={() => setAdding(true)}
          aria-label="adicionar projeto"
          title="adicionar projeto"
        >
          +
        </button>
      )}
    </section>
  );
}

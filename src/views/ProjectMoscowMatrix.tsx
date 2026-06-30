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
import { DraggableProjectCard } from '../components/DraggableProjectCard';
import { DroppableSection } from '../components/DroppableSection';
import { ProjectCard } from '../components/ProjectCard';
import type { VolatilityBands } from '../lib/glicko2';
import type { GlickoMap } from '../repositories/glickoRepo';
import { patchProject } from '../repositories/projectsRepo';
import type { MoSCoW, Project } from '../types';

const DROP_PREFIX = 'pmoscow:';

interface QuadrantSpec {
  key: Exclude<MoSCoW, ''>;
  label: string;
  desc: string;
  badgeClass: string;
}

// Os quatro quadrantes da matriz (2×2), em ordem decrescente de prioridade.
// Won't é a base: projetos sem classificação caem aqui (ver projectsRepo).
const QUADRANTS: QuadrantSpec[] = [
  { key: 'must', label: 'Must', desc: 'Crítico — prioridade máxima', badgeClass: 'col-must' },
  { key: 'should', label: 'Should', desc: 'Importante — fazer em seguida', badgeClass: 'col-should' },
  { key: 'could', label: 'Could', desc: 'Desejável — se houver tempo', badgeClass: 'col-could' },
  { key: 'wont', label: "Won't", desc: 'Base — fora do escopo atual', badgeClass: 'col-wont' },
];

export function ProjectMoscowMatrix({
  uid,
  projects,
  taskCountByProject,
  glickoMap,
  volatilityBands,
}: {
  uid: string;
  projects: Project[];
  taskCountByProject: Record<string, { total: number; done: number }>;
  glickoMap: GlickoMap;
  volatilityBands?: VolatilityBands;
}) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const projectMap = useMemo(() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const grouped = useMemo(() => {
    const g: Record<string, Project[]> = { must: [], should: [], could: [], wont: [] };
    for (const p of projects) {
      // Won't é a base: sem MoSCoW cai em Won't.
      const k = p.moscow || 'wont';
      (g[k] ??= []).push(p);
    }
    return g;
  }, [projects]);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith(DROP_PREFIX)) return;
    const newKey = overId.slice(DROP_PREFIX.length);

    const projectId = String(e.active.id);
    const project = projectMap[projectId];
    if (!project) return;
    const current = project.moscow || 'wont';
    if (current === newKey) return;

    await patchProject(uid, projectId, { moscow: newKey as MoSCoW });
  }

  const activeProject = activeDragId ? projectMap[activeDragId] : null;

  function renderQuadrant(spec: QuadrantSpec) {
    const list = grouped[spec.key] ?? [];
    return (
      <div key={spec.key} className="moscow-quadrant">
        <header className={`moscow-quadrant-header ${spec.badgeClass}`}>
          <div className="moscow-quadrant-heading">
            <span className="moscow-quadrant-label">{spec.label}</span>
            <span className="moscow-quadrant-desc">{spec.desc}</span>
          </div>
          <span className="moscow-quadrant-count">{list.length}</span>
        </header>
        <DroppableSection id={`${DROP_PREFIX}${spec.key}`}>
          <div className="project-list moscow-quadrant-body">
            {list.map((p) => (
              <DraggableProjectCard
                key={p.id}
                project={p}
                taskCount={taskCountByProject[p.id]?.total ?? 0}
                doneTaskCount={taskCountByProject[p.id]?.done ?? 0}
                glickoRating={glickoMap[p.id]}
                volatilityBands={volatilityBands}
                compact
              />
            ))}
            {list.length === 0 && (
              <p className="drop-hint muted">arraste projetos aqui</p>
            )}
          </div>
        </DroppableSection>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="moscow-matrix">{QUADRANTS.map(renderQuadrant)}</div>

      <DragOverlay dropAnimation={null}>
        {activeProject && (
          <div className="drag-overlay">
            <ProjectCard
              project={activeProject}
              taskCount={taskCountByProject[activeProject.id]?.total ?? 0}
              doneTaskCount={taskCountByProject[activeProject.id]?.done ?? 0}
              glickoRating={glickoMap[activeProject.id]}
              volatilityBands={volatilityBands}
              compact
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

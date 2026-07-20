import type { ProjectFiltersState } from '../components/ProjectFiltersBar';
import { normalizeForSearch } from './searchNormalize';
import type { Project } from '../types';

// Progresso (0..1) por projeto: fração de tarefas concluídas. Projetos sem
// tarefas ficam como null (sem progresso definido). Recebe o
// `taskCountByProject` já calculado (ver `buildTaskCountByProject`) para não
// recontar as tarefas quando o chamador já precisa desse mapa por outro
// motivo (ex.: exibir a contagem nos cards).
export function computeProgressByProject(
  projects: Project[],
  taskCountByProject: Record<string, { total: number; done: number }>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const p of projects) {
    const c = taskCountByProject[p.id];
    out[p.id] = c && c.total > 0 ? c.done / c.total : null;
  }
  return out;
}

// Aplica o filtro de status + busca da aba Projetos e ordena conforme o
// `sortMode` selecionado. Compartilhado entre a `ProjectsView` (renderização)
// e a exportação em PDF, para que ambas mostrem exatamente os mesmos
// projetos, na mesma ordem.
export function filterAndSortProjects(
  projects: Project[],
  filters: ProjectFiltersState,
  searchQuery: string,
  progressByProject: Record<string, number | null>,
): Project[] {
  const q = normalizeForSearch(searchQuery.trim());
  const list = projects.filter((p) => {
    if (!filters.statusFilter.has(p.status)) return false;
    if (q) {
      const haystack = normalizeForSearch([p.name, ...p.categories].join('\n'));
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  if (filters.sortMode === 'progress') {
    // Maior conclusão primeiro. Projetos sem tarefas (null) vão para o fim,
    // preservando entre empates a ordem manual (por nota) original.
    return list
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => {
        const pa = progressByProject[a.p.id];
        const pb = progressByProject[b.p.id];
        const va = pa ?? -1;
        const vb = pb ?? -1;
        if (vb !== va) return vb - va;
        return a.idx - b.idx;
      })
      .map((x) => x.p);
  }
  // 'score': mantém a ordem manual (maior nota primeiro), já vinda do repo.
  return list;
}

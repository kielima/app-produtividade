import { describe, expect, it } from 'vitest';
import { defaultProjectFiltersState } from '../components/ProjectFiltersBar';
import { filterAndSortProjects } from './projectFilterSort';
import type { Project } from '../types';

function proj(id: string, tipo: Project['tipo']): Project {
  return {
    id,
    name: id,
    area: '',
    categories: [],
    status: 'Em andamento',
    priority: '',
    moscow: '',
    objective: '',
    currentStatus: '',
    nextSteps: '',
    deadline: '',
    estimatedDuration: '',
    dependsOn: null,
    notes: '',
    tipo,
  };
}

const lista = [proj('a', 'projeto'), proj('b', 'processo'), proj('c', null)];

function ids(tipoFilter: 'todos' | 'projeto' | 'processo') {
  const filters = { ...defaultProjectFiltersState(), tipoFilter };
  return filterAndSortProjects(lista, filters, '', {}).map((p) => p.id).sort();
}

describe('filtro de tipo (projeto × processo)', () => {
  it('todos mostra tudo', () => {
    expect(ids('todos')).toEqual(['a', 'b', 'c']);
  });
  it('projetos inclui os não classificados', () => {
    expect(ids('projeto')).toEqual(['a', 'c']);
  });
  it('processos mostra só os processos', () => {
    expect(ids('processo')).toEqual(['b']);
  });
});

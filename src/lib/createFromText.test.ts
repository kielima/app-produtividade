import { describe, expect, it } from 'vitest';
import { pickDefaultProjectId } from './createFromText';
import type { Project } from '../types';

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 'id',
    name: 'Projeto',
    status: 'Ativo',
    ...overrides,
  } as Project;
}

describe('pickDefaultProjectId', () => {
  it('prefere o projeto "Tarefas sem projeto" mesmo que não seja o primeiro', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Trabalho' }),
      makeProject({ id: 'p2', name: 'Tarefas sem projeto' }),
      makeProject({ id: 'p3', name: 'Pessoal' }),
    ];
    expect(pickDefaultProjectId(projects)).toBe('p2');
  });

  it('ignora projetos concluídos/cancelados ao procurar "Tarefas sem projeto"', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Tarefas sem projeto', status: 'Cancelado' }),
      makeProject({ id: 'p2', name: 'Trabalho' }),
    ];
    expect(pickDefaultProjectId(projects)).toBe('p2');
  });

  it('cai para o primeiro projeto ativo quando não existe "Tarefas sem projeto"', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Trabalho' }),
      makeProject({ id: 'p2', name: 'Pessoal' }),
    ];
    expect(pickDefaultProjectId(projects)).toBe('p1');
  });

  it('retorna null quando não há projetos disponíveis', () => {
    expect(pickDefaultProjectId([])).toBeNull();
  });
});

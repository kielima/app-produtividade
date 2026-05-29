import { describe, expect, it } from 'vitest';
import { computeBlockTransitions } from './projectBlocking';
import type { Project, Task } from '../types';

function makeProject(p: Partial<Project> & { id: string }): Project {
  return {
    name: p.id,
    area: '',
    status: 'Em andamento',
    priority: '',
    objective: '',
    currentStatus: '',
    nextSteps: '',
    deadline: '',
    estimatedDuration: '',
    dependsOn: null,
    notes: '',
    ...p,
  };
}

function makeTask(section: string, checked: boolean, id = `${section}-${Math.random()}`): Task {
  return {
    id,
    taskId: null,
    title: id,
    note: '',
    checked,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: '',
    dependsOn: [],
    subtasks: [],
    section,
    completedAt: null,
  };
}

describe('computeBlockTransitions', () => {
  it('pausa projeto bloqueado e memoriza o status anterior', () => {
    const projects = [
      makeProject({ id: 'blocker', status: 'Em andamento' }),
      makeProject({ id: 'dep', status: 'Em andamento', dependsOn: 'blocker' }),
    ];
    const tasks = [makeTask('blocker', false)];

    const out = computeBlockTransitions(projects, tasks);
    expect(out).toEqual([
      { id: 'dep', patch: { status: 'Pausado', statusBeforeBlock: 'Em andamento' } },
    ]);
  });

  it('não repausa um projeto que já está Pausado', () => {
    const projects = [
      makeProject({ id: 'blocker' }),
      makeProject({
        id: 'dep',
        status: 'Pausado',
        statusBeforeBlock: 'Em andamento',
        dependsOn: 'blocker',
      }),
    ];
    const tasks = [makeTask('blocker', false)];

    expect(computeBlockTransitions(projects, tasks)).toEqual([]);
  });

  it('reverte para o status anterior quando a dependência fica 100% concluída', () => {
    const projects = [
      makeProject({ id: 'blocker' }),
      makeProject({
        id: 'dep',
        status: 'Pausado',
        statusBeforeBlock: 'Em andamento',
        dependsOn: 'blocker',
      }),
    ];
    const tasks = [makeTask('blocker', true), makeTask('blocker', true)];

    const out = computeBlockTransitions(projects, tasks);
    expect(out).toEqual([
      { id: 'dep', patch: { statusBeforeBlock: null, status: 'Em andamento' } },
    ]);
  });

  it('reverte quando a dependência é removida do projeto', () => {
    const projects = [
      makeProject({ id: 'blocker' }),
      makeProject({
        id: 'dep',
        status: 'Pausado',
        statusBeforeBlock: 'Em planejamento',
        dependsOn: null,
      }),
    ];
    const tasks = [makeTask('blocker', false)];

    const out = computeBlockTransitions(projects, tasks);
    expect(out).toEqual([
      { id: 'dep', patch: { statusBeforeBlock: null, status: 'Em planejamento' } },
    ]);
  });

  it('só limpa o snapshot (sem mexer no status) se o usuário já tirou de Pausado', () => {
    const projects = [
      makeProject({ id: 'blocker' }),
      makeProject({
        id: 'dep',
        status: 'Em andamento',
        statusBeforeBlock: 'Em planejamento',
        dependsOn: 'blocker',
      }),
    ];
    const tasks = [makeTask('blocker', true)];

    const out = computeBlockTransitions(projects, tasks);
    expect(out).toEqual([{ id: 'dep', patch: { statusBeforeBlock: null } }]);
  });

  it('não bloqueia quando a dependência não tem tarefas', () => {
    const projects = [
      makeProject({ id: 'blocker' }),
      makeProject({ id: 'dep', status: 'Em andamento', dependsOn: 'blocker' }),
    ];

    expect(computeBlockTransitions(projects, [])).toEqual([]);
  });

  it('ignora dependência que aponta para projeto inexistente, mas reverte se havia snapshot', () => {
    const projects = [
      makeProject({
        id: 'dep',
        status: 'Pausado',
        statusBeforeBlock: 'Em andamento',
        dependsOn: 'fantasma',
      }),
    ];

    const out = computeBlockTransitions(projects, []);
    expect(out).toEqual([
      { id: 'dep', patch: { statusBeforeBlock: null, status: 'Em andamento' } },
    ]);
  });
});

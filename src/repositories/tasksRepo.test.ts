import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../types';

// Estado do cliente Supabase falso: a busca inicial devolve `initialRows`
// (opcionalmente barrada por `gate`, para simular latência) e o upsert só
// guarda a linha — nenhum evento de Realtime é emitido em nenhum teste, que
// é justamente o cenário que o eco local precisa cobrir.
const mockState = vi.hoisted(() => ({
  initialRows: [] as Record<string, unknown>[],
  upserted: [] as Record<string, unknown>[],
  gate: null as Promise<void> | null,
}));

vi.mock('../lib/supabase', () => {
  function makeQuery() {
    const query = {
      eq: () => query,
      order: () => query,
      limit: () => query,
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => mockState.gate)
          .then(() => ({ data: mockState.initialRows, error: null }))
          .then(onFulfilled, onRejected),
    };
    return query;
  }
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    supabase: {
      from: () => ({
        select: () => makeQuery(),
        upsert: (row: Record<string, unknown>) => {
          mockState.upserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

const { subscribeToTasks, upsertTask } = await import('./tasksRepo');

function makeTask(id: string): Task {
  return {
    id,
    taskId: Number(id),
    title: `[#${id}] tarefa nova`,
    note: '',
    checked: false,
    inProgress: false,
    moscow: '',
    modo: 'manual',
    esforco: '',
    deadline: '',
    addedDate: '2026-01-01',
    dependsOn: [],
    section: 'proj-1',
    completedAt: null,
  };
}

// Deixa correr as promises pendentes (busca inicial, upsert).
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('upsertTask — eco local', () => {
  beforeEach(() => {
    mockState.initialRows = [];
    mockState.upserted = [];
    mockState.gate = null;
  });

  it('publica a tarefa na assinatura antes de qualquer evento do Realtime', async () => {
    const emissions: Task[][] = [];
    const unsubscribe = subscribeToTasks('u1', (tasks) => emissions.push(tasks));
    await flush();
    expect(emissions.at(-1)).toEqual([]);

    await upsertTask('u1', makeTask('7'));

    // Sem o eco, a lista só mudaria quando o websocket entregasse o INSERT —
    // e quem navega logo após o await não encontraria a tarefa.
    expect(emissions.at(-1)?.map((t) => t.id)).toEqual(['7']);
    expect(emissions.at(-1)?.[0]?.title).toBe('[#7] tarefa nova');
    unsubscribe();
  });

  it('atualiza a tarefa já existente em vez de duplicá-la', async () => {
    mockState.initialRows = [
      {
        id: '7',
        user_id: 'u1',
        task_id: 7,
        title: '[#7] título antigo',
        note: null,
        checked: false,
        in_progress: false,
        moscow: null,
        modo: 'manual',
        esforco: null,
        deadline: null,
        added_date: '2026-01-01',
        depends_on: null,
        parent_id: null,
        order: null,
        project_id: 'proj-1',
        completed_at: null,
        completed_from_section_name: null,
        snoozed_until: null,
        source_item_id: null,
        source_annotation_id: null,
      },
    ];
    const emissions: Task[][] = [];
    const unsubscribe = subscribeToTasks('u1', (tasks) => emissions.push(tasks));
    await flush();

    await upsertTask('u1', { ...makeTask('7'), title: '[#7] título novo' });

    expect(emissions.at(-1)?.map((t) => t.title)).toEqual(['[#7] título novo']);
    unsubscribe();
  });

  it('preserva a tarefa ecoada enquanto a busca inicial ainda está em voo', async () => {
    let openGate = () => {};
    mockState.gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const emissions: Task[][] = [];
    const unsubscribe = subscribeToTasks('u1', (tasks) => emissions.push(tasks));

    await upsertTask('u1', makeTask('7'));
    expect(emissions.at(-1)?.map((t) => t.id)).toEqual(['7']);

    // A busca inicial (disparada antes do upsert) não traz a tarefa nova; ela
    // não pode ser apagada da lista quando o resultado chegar.
    openGate();
    await flush();
    expect(emissions.at(-1)?.map((t) => t.id)).toEqual(['7']);
    unsubscribe();
  });

  it('para de ecoar depois de cancelar a assinatura', async () => {
    const emissions: Task[][] = [];
    const unsubscribe = subscribeToTasks('u1', (tasks) => emissions.push(tasks));
    await flush();
    unsubscribe();

    await upsertTask('u1', makeTask('7'));

    expect(emissions.at(-1)).toEqual([]);
  });
});

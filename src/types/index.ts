export type MoSCoW = 'must' | 'should' | 'could' | 'wont' | '';
export type Modo = 'manual' | 'colaborar' | 'delegar';
export type Esforco = 'rapido' | 'medio' | 'longo' | '';

export interface Subtask {
  text: string;
  checked: boolean;
}

export interface Task {
  id: string;
  taskId: number | null;
  title: string;
  note: string;
  checked: boolean;
  inProgress: boolean;
  moscow: MoSCoW;
  modo: Modo;
  esforco: Esforco;
  deadline: string;
  addedDate: string;
  dependsOn: string[];
  subtasks: Subtask[];
  // Id (doc id) da tarefa pai. Quando preenchido, esta tarefa é uma
  // subtarefa (filha): fica oculta das listas principais e aparece apenas
  // dentro da página do pai. null/ausente = tarefa de topo.
  parentId?: string | null;
  section: string;
  // Preenchido quando `checked=true`. Usado pelas estatísticas e pelo
  // gráfico de atividade. Para tarefas ativas é null.
  completedAt: Date | null;
  // Snapshot do nome do projeto no momento da conclusão. Permite mostrar
  // o nome mesmo depois que o projeto for deletado.
  completedFromSectionName?: string | null;
}

export interface Section {
  id: string;
  name: string;
  moscow: MoSCoW;
  order?: number;
}

export type ProjectStatus =
  | 'A iniciar'
  | 'Em planejamento'
  | 'Em andamento'
  | 'Pausado'
  | 'Concluído'
  | 'Cancelado';

export type ProjectPriority = 'P1' | 'P2' | 'P3' | '';

export interface Project {
  id: string;
  name: string;
  area: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  objective: string;
  currentStatus: string;
  nextSteps: string;
  deadline: string;
  estimatedDuration: string;
  dependsOn: string | null;
  notes: string;
  order?: number;
  // Snapshot do status que o projeto tinha antes de ser pausado
  // automaticamente por estar bloqueado por uma dependência. Quando o
  // bloqueio é levantado, o status é restaurado a partir daqui e o campo
  // volta a null. Em projetos não bloqueados é null/undefined.
  statusBeforeBlock?: ProjectStatus | null;
}

export interface Note {
  id: string;
  title: string;
  note: string;
  items: Subtask[];
  addedDate: string;
  tags: string[];
  pinned: boolean;
  projectId?: string;
  color?: string;
}

export interface DependencyEntry {
  blockedByIds: string[];
  unlocksIds: string[];
}

export interface ScoreContext {
  depMap: Record<string, DependencyEntry>;
  potentialScoreMap: Record<string, number>;
  taskFlatMap: Record<string, Task>;
  projectScoreMap: Record<string, number>;
  // Fecho transitivo de `unlocksIds`: para cada tarefa, todos os ids que estão
  // travados (direta ou indiretamente) por ela. Não inclui a própria tarefa.
  transitiveUnlocksMap: Record<string, string[]>;
  // Score total da tarefa mais atrasada (maior |dias_atraso|). Usado como
  // referência para o bônus de prazo de tarefas upcoming.
  maxOverdueScore: number;
}

export type MoSCoW = 'must' | 'should' | 'could' | 'wont' | '';
export type Modo = 'manual' | 'colaborar' | 'delegar' | 'automatizar' | '';
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
  section: string;
}

export interface Section {
  id: string;
  name: string;
  moscow: MoSCoW;
  order?: number;
}

export type ProjectStatus =
  | 'A iniciar'
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
  dependsOn: string;
  notes: string;
  order?: number;
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
}

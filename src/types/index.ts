export type MoSCoW = 'must' | 'should' | 'could' | 'wont' | '';
export type Modo = 'manual' | 'colaborar' | 'delegar';
export type Esforco = 'rapido' | 'medio' | 'longo' | '';

export interface Subtask {
  text: string;
  checked: boolean;
  // Quando true, esta subtarefa depende da subtarefa imediatamente anterior:
  // fica bloqueada (não pode ser concluída) até a anterior estar concluída.
  blockedByPrev?: boolean;
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
  // Ordem manual entre tarefas-filhas (irmãs com o mesmo parentId). Definido
  // ao arrastar para reordenar as subtarefas no detalhe da tarefa. Quando
  // ausente, ordena-se por `taskId` (ordem de criação). null/ausente = sem
  // ordenação manual.
  order?: number | null;
  section: string;
  // Preenchido quando `checked=true`. Usado pelas estatísticas e pelo
  // gráfico de atividade. Para tarefas ativas é null.
  completedAt: Date | null;
  // Snapshot do nome do projeto no momento da conclusão. Permite mostrar
  // o nome mesmo depois que o projeto for deletado.
  completedFromSectionName?: string | null;
  // Data (YYYY-MM-DD) até a qual a tarefa fica adiada ("silenciada"): some
  // das listas principais e reaparece automaticamente nesse dia. Útil para
  // tarefas que estão temporariamente impedidas de serem feitas — adiá-las
  // reduz a ansiedade de vê-las pendentes sem poder agir. null/ausente =
  // tarefa ativa (não adiada). Não é serializado no título — campo puro do
  // Firestore, como `inProgress`/`completedAt`/`parentId`.
  snoozedUntil?: string | null;
  // Preenchidos quando a tarefa nasce de uma anotação da aba Leitura: apontam
  // de volta para o item/anotação de origem, permitindo abrir o PDF direto na
  // marcação (ver `useReadingNavigation`). Ausentes em tarefas criadas de
  // outra forma.
  sourceItemId?: string;
  sourceAnnotationId?: string;
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
  // Categorias livres do projeto. Usadas para agrupar/visualizar projetos por
  // categoria na aba Projetos. Um projeto pode ter várias categorias e aparece
  // em cada grupo correspondente. Vazio = "(sem categoria)".
  categories: string[];
  status: ProjectStatus;
  priority: ProjectPriority;
  // Classificação MoSCoW do projeto (Must/Should/Could/Won't). Usada pela
  // visualização "Matriz" da aba Projetos, onde cada projeto é arrastado para
  // o quadrante correspondente. Vazio = sem classificação.
  moscow: MoSCoW;
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
  // Preenchidos quando a nota nasce de uma anotação da aba Leitura: apontam
  // de volta para o item/anotação de origem, permitindo abrir o PDF direto na
  // marcação (ver `useReadingNavigation`). Ausentes em notas criadas de outra
  // forma.
  sourceItemId?: string;
  sourceAnnotationId?: string;
}

// =============================================================
// Aba "Leitura" — estante virtual de PDFs vindos do Google Drive,
// com metadados (DOI/ISBN/ISSN/autores/tags) e anotações
// não-destrutivas (marca-texto, comentário e tinta da S-Pen).
// =============================================================

// Formato do documento. Por ora só 'pdf'; 'epub' fica para fase futura.
export type ReadingFormat = 'pdf';
// Tipo do item da estante. Os três embutidos ('article' | 'book' | 'other')
// ganham rótulos amigáveis; qualquer outro texto é um tipo personalizado
// criado pelo usuário no editor de metadados. Cada tipo distinto vira uma
// "estante" (carrossel) própria na visualização em estante. O `(string & {})`
// mantém o autocompletar dos embutidos sem impedir strings arbitrárias.
export type ReadingItemType = 'article' | 'book' | 'other' | (string & {});
export type ReadingStatus = 'to-read' | 'reading' | 'read';

export interface ReadingItem {
  id: string;
  // Id do arquivo no Google Drive. É a chave para baixar os bytes do PDF.
  driveFileId: string;
  // Nome do arquivo no Google Drive (com extensão). Espelha o nome real no
  // Drive: a sincronização traz daqui e renomear pelo app reescreve aqui e lá.
  fileName?: string;
  // Id da pasta que contém o arquivo no Drive. Permite montar o link direto
  // para abrir a pasta (https://drive.google.com/drive/folders/{folderId}).
  folderId?: string;
  // Caminho legível da pasta no Drive, da raiz até a pasta imediata
  // (ex.: "Meu Drive / Artigos / 2024"). Preenchido na sincronização.
  folderPath?: string;
  format: ReadingFormat;
  title: string;
  authors: string[];
  itemType: ReadingItemType;
  doi?: string;
  isbn?: string;
  issn?: string;
  year?: string;
  // Revista (artigos) ou editora (livros).
  publication?: string;
  tags: string[];
  addedDate: string; // YYYY-MM-DD
  // ISO datetime da última abertura no leitor (para ordenar "recentes").
  lastOpenedAt?: string | null;
  readingStatus: ReadingStatus;
  // Última página lida (1-based) para retomar a leitura.
  currentPage?: number;
  // Associação opcional a um projeto, como nas notas.
  projectId?: string;
}

export type AnnotationType = 'highlight' | 'comment' | 'ink';

// Retângulo normalizado (0–1) relativo à página. Sobrevive a zoom e a
// diferentes escalas de render.
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Ponto de um traço de tinta: coordenadas normalizadas (0–1) + pressão (0–1).
export interface InkPoint {
  x: number;
  y: number;
  p: number;
}

export interface InkStroke {
  points: InkPoint[];
  // Largura base do traço em fração da largura da página (0–1).
  width: number;
}

export interface Annotation {
  id: string;
  itemId: string;
  page: number; // 1-based
  type: AnnotationType;
  color: string;
  // highlight: quadpoints normalizados das linhas selecionadas.
  rects?: NormRect[];
  // Texto selecionado (highlight) — usado também ao converter em nota/tarefa.
  text?: string;
  // Título opcional dado pelo usuário; vira o título da nota/tarefa na conversão.
  title?: string;
  // Corpo do comentário (type 'comment', ou comentário anexado a um highlight).
  comment?: string;
  // Traços de tinta da S-Pen (type 'ink').
  strokes?: InkStroke[];
  // Posição do pin do comentário (0–1), para type 'comment'.
  anchor?: { x: number; y: number };
  createdAt: string; // ISO datetime
  // Id da tarefa/nota criada a partir desta anotação (vínculo bidirecional:
  // a tarefa/nota guarda `sourceItemId`/`sourceAnnotationId` de volta para
  // cá). Preenchido ao converter pelo editor de anotação da aba Leitura.
  linkedTaskId?: string;
  linkedNoteId?: string;
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

// Tipo + heurística de "é markdown?" isolados num módulo sem nenhuma
// dependência de rede/Firebase — usados tanto pela lógica pura testável
// (obsidianTreeState.ts, driveFileIcons.tsx) quanto pelas chamadas reais ao
// Drive (obsidianDrive.ts). Mantido separado de obsidianDrive.ts para que
// importar só isto (em testes) não arraste googleDrive.ts/firebase.ts.

export type DriveNode = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  isFolder: boolean;
};

// O Drive não marca mimeType de forma confiável para arquivos .md enviados
// por outras ferramentas (frequentemente vêm como text/plain ou vazio), então
// o nome do arquivo é o sinal mais confiável. Google Docs/Sheets/Slides
// nativos nunca contam como markdown mesmo que o usuário os nomeie "algo.md":
// são tipos "application/vnd.google-apps.*" sem conteúdo binário próprio, e
// `alt=media` (usado por readMarkdownContent) rejeita esses ids — tratá-los
// como markdown quebraria a busca de conteúdo ao expandir a pasta.
export function isMarkdownFile(node: Pick<DriveNode, 'name' | 'mimeType'>): boolean {
  if (node.mimeType.startsWith('application/vnd.google-apps.')) return false;
  if (node.name.toLowerCase().endsWith('.md')) return true;
  return node.mimeType === 'text/markdown';
}

// Pastas sem `parents` (vazio/ausente) não têm caminho de volta até a raiz
// (`'root'`) — é assim que a seção "Computadores" do Google Drive (backup do
// Google Drive para desktop) se comporta: a API não expõe nenhuma consulta
// que a devolva a partir de `'root' in parents`, mesmo que o usuário a veja
// normalmente na interface do Drive. Uma vez que se conhece o id dessas
// pastas, listar o conteúdo delas funciona normalmente — só a descoberta a
// partir da raiz que não funciona. Usado por listOrphanTopLevelFolders em
// obsidianDrive.ts pra achá-las e mostrá-las junto na raiz da árvore.
export function isOrphanTopLevelFolder(file: { id: string; parents?: string[] }, rootId: string): boolean {
  if (file.id === rootId) return false;
  return !file.parents || file.parents.length === 0;
}

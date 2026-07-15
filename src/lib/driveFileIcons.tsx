import { isMarkdownFile } from './grafosNode';

export type DriveIconKind =
  | 'folder'
  | 'markdown'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'pdf'
  | 'image'
  | 'html'
  | 'file';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

// Mesma heurística de isMarkdownFile (mimeType de upload não é confiável):
// nome termina em .html/.htm ou o Drive marcou text/html corretamente.
export function isHtmlFile(node: { name: string; mimeType: string }): boolean {
  const lower = node.name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return true;
  return node.mimeType === 'text/html';
}

// Categoria ampla por mimeType — só o suficiente pro navegador de pastas da
// aba Grafos mostrar um glifo diferente por tipo (spec item 3). Não cobre
// o styling do grafo unificado (Fase 3).
export function driveIconKind(node: { name: string; mimeType: string }): DriveIconKind {
  if (node.mimeType === FOLDER_MIME_TYPE) return 'folder';
  if (isMarkdownFile(node)) return 'markdown';
  if (node.mimeType === 'application/vnd.google-apps.document') return 'doc';
  if (node.mimeType === 'application/vnd.google-apps.spreadsheet') return 'sheet';
  if (node.mimeType === 'application/vnd.google-apps.presentation') return 'slide';
  if (node.mimeType === 'application/pdf') return 'pdf';
  if (node.mimeType.startsWith('image/')) return 'image';
  if (isHtmlFile(node)) return 'html';
  return 'file';
}

const PATHS: Record<DriveIconKind, string> = {
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
  markdown: 'M3 5h18v14H3z M6 15V9l3 3 3-3v6 M15 9v6 M13 13l2 2 2-2',
  doc: 'M6 2h9l5 5v15H6z M15 2v5h5 M8 12h8 M8 16h8 M8 8h4',
  sheet: 'M6 2h9l5 5v15H6z M15 2v5h5 M8 11h8 M8 15h8 M11 9v10',
  slide: 'M6 2h9l5 5v15H6z M15 2v5h5 M8 11h8v5H8z',
  pdf: 'M6 2h9l5 5v15H6z M15 2v5h5 M8 12h2a1.5 1.5 0 0 1 0 3H8v-3z M13 12v4h1.5a2 2 0 0 0 0-4H13z',
  image: 'M4 5h16v14H4z M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M4 16l5-5 4 4 3-3 4 4',
  html: 'M3 4h18v16H3z M3 8h18 M7 13l-2 2 2 2 M17 13l2 2-2 2 M13 12l-2 6',
  file: 'M6 2h9l5 5v15H6z M15 2v5h5',
};

export function DriveFileIcon({
  node,
  size = 18,
}: {
  node: { name: string; mimeType: string };
  size?: number;
}) {
  const kind = driveIconKind(node);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`drive-file-icon drive-file-icon--${kind}`}
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}

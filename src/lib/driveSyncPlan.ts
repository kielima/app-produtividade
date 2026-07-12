import type { ReadingFormat, ReadingItem } from '../types';
import { classifyByFileName } from './classifyByFilename';

export type DriveSyncPlan =
  | { kind: 'create'; item: ReadingItem }
  | { kind: 'update'; patch: Partial<ReadingItem> }
  | { kind: 'skip' };

// Formato pelo mimeType do Drive (mais confiável) com fallback pela extensão
// do nome do arquivo. Qualquer coisa que não seja reconhecidamente EPUB cai em
// 'pdf' — é o único outro formato sincronizado (ver READING_MIME_TYPES).
function formatFromFile(name: string, mimeType?: string): ReadingFormat {
  if (mimeType === 'application/epub+zip' || /\.epub$/i.test(name)) return 'epub';
  return 'pdf';
}

function stripExtension(name: string, format: ReadingFormat): string {
  return name.replace(format === 'epub' ? /\.epub$/i : /\.pdf$/i, '');
}

// EPUB é (quase) sempre livro — diferente do PDF, que mistura artigos e
// livros e por isso depende da heurística de nome em `classifyByFileName`.
// Classifica todo EPUB como 'book' direto na sincronização, sem esperar o
// usuário abrir o arquivo nem chamar IA.
function classifyByFormat(format: ReadingFormat): 'book' | null {
  return format === 'epub' ? 'book' : null;
}

// Decide o que fazer com um arquivo do Drive SEM tocar o Firestore — usa o
// item já carregado localmente (do listener em tempo real) em vez de um
// getDoc por arquivo. Sincronizar milhares de PDFs um de cada vez (leitura +
// eventual escrita por arquivo) é o gargalo da sincronização do Drive;
// decidir em memória permite juntar as escritas num único lote depois. O id
// do doc é o próprio driveFileId, então aplicar o plano é idempotente: não
// duplica itens nem sobrescreve metadados/anotações que o usuário já editou.
export function planDriveSyncItem(
  existing: ReadingItem | undefined,
  file: { id: string; name: string; mimeType?: string; folderId?: string; folderPath?: string },
): DriveSyncPlan {
  if (!existing) {
    const today = new Date().toISOString().slice(0, 10);
    // Nome no estilo de citação ABNT ("SOBRENOME, 2020...") já classifica
    // como artigo na hora, sem esperar o usuário abrir o arquivo nem chamar IA.
    const format = formatFromFile(file.name, file.mimeType);
    const byName = classifyByFormat(format) ?? classifyByFileName(file.name);
    return {
      kind: 'create',
      item: {
        id: file.id,
        driveFileId: file.id,
        fileName: file.name,
        ...(file.folderId != null ? { folderId: file.folderId } : {}),
        ...(file.folderPath != null ? { folderPath: file.folderPath } : {}),
        format,
        title: stripExtension(file.name, format),
        authors: [],
        itemType: byName ?? 'other',
        tags: [],
        addedDate: today,
        readingStatus: 'to-read',
        ...(byName ? { autoClassifiedAt: new Date().toISOString() } : {}),
      },
    };
  }

  // Item já existe: o Drive é a fonte de verdade do nome do arquivo e da
  // pasta, então espelha o estado atual no app (cobre itens antigos sem
  // fileName/pasta e arquivos renomeados ou movidos direto no Drive). Não
  // toca em mais nenhum metadado editado.
  const patch: Partial<ReadingItem> = {};
  if (existing.fileName !== file.name) patch.fileName = file.name;
  if (file.folderId != null && existing.folderId !== file.folderId) {
    patch.folderId = file.folderId;
  }
  if (file.folderPath != null && existing.folderPath !== file.folderPath) {
    patch.folderPath = file.folderPath;
  }
  // Item antigo, ainda sem tipo definido: aproveita a resincronização para
  // classificar (EPUB vira 'book' direto; PDF ainda depende do nome), sem
  // esperar o usuário abrir o arquivo um por um.
  if (existing.itemType === 'other' && !existing.autoClassifiedAt) {
    const byName = classifyByFormat(existing.format) ?? classifyByFileName(file.name);
    if (byName) {
      patch.itemType = byName;
      patch.autoClassifiedAt = new Date().toISOString();
    }
  }
  if (Object.keys(patch).length === 0) return { kind: 'skip' };
  return { kind: 'update', patch };
}

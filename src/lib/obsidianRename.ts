import { renameDriveFile } from './googleDrive';
import {
  ensureDriveToken,
  isMarkdownFile,
  readMarkdownContent,
  searchFilesContainingText,
  writeMarkdownContent,
} from './obsidianDrive';
import { stripMdExtension } from './obsidianWikilink';
import { replaceWikilinkTarget } from './obsidianWikilinkReplace';

export type RenameOutcome = { updatedCount: number; failedIds: string[] };

// Renomeia o arquivo no Drive e depois busca no Drive INTEIRO (spec item 7,
// via searchFilesContainingText — não limitado ao que já foi carregado nesta
// sessão) por notas que citam o nome antigo, corrigindo os wikilinks nelas.
// Cada arquivo candidato é lido e regravado imediatamente (leitura-
// modificação-escrita), sem depender de nenhum cache de sessão — por isso não
// precisa do diálogo de conflito da Fase 1 aqui: a janela de corrida é
// mínima e não há edição local em jogo para essas outras notas.
export async function renameNoteAndFixLinks(
  uid: string,
  fileId: string,
  oldName: string,
  newName: string,
): Promise<RenameOutcome> {
  const token = await ensureDriveToken(uid);
  await renameDriveFile(uid, fileId, newName);

  const oldDisplayName = stripMdExtension(oldName);
  const newDisplayName = stripMdExtension(newName);

  const candidates = await searchFilesContainingText(token, oldDisplayName);
  let updatedCount = 0;
  const failedIds: string[] = [];

  for (const candidate of candidates) {
    if (candidate.id === fileId) continue;
    if (!isMarkdownFile(candidate)) continue;
    try {
      const content = await readMarkdownContent(token, candidate.id);
      const updated = replaceWikilinkTarget(content, oldDisplayName, newDisplayName);
      if (updated !== content) {
        await writeMarkdownContent(token, candidate.id, updated);
        updatedCount++;
      }
    } catch {
      failedIds.push(candidate.id);
    }
  }

  return { updatedCount, failedIds };
}

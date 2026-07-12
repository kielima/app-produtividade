import { downloadDriveFile, ensureDriveToken } from './googleDrive';
import { getCachedPdf, putCachedPdf } from './pdfCache';

// Obtém os bytes de um arquivo da estante (PDF ou EPUB): primeiro do cache
// local; senão baixa do Drive (garantindo um token válido) e cacheia. Lança
// DriveAuthError se o acesso ao Drive expirou/foi revogado (o chamador deve
// oferecer reconectar).
export async function fetchReadingFileBytes(
  uid: string,
  driveFileId: string,
): Promise<ArrayBuffer> {
  const cached = await getCachedPdf(driveFileId);
  if (cached && cached.byteLength > 0) return cached;

  const token = await ensureDriveToken(uid);
  const bytes = await downloadDriveFile(token, driveFileId);
  // Cacheia uma cópia; o original segue para o pdf.js.
  void putCachedPdf(driveFileId, bytes.slice(0));
  return bytes;
}

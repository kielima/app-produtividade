// Cache local dos bytes de PDFs/EPUBs baixados do Drive, via Cache API. Evita
// rebaixar o mesmo arquivo a cada abertura e dá resiliência offline. Chaveado
// por driveFileId sob uma URL sintética (o nome do módulo é histórico — o
// cache é genérico por bytes, serve os dois formatos da aba Leitura).

const CACHE_NAME = 'reading-pdf-cache-v1';
const PREFIX = 'https://pdf-cache.local/';

function keyFor(fileId: string): string {
  return `${PREFIX}${encodeURIComponent(fileId)}`;
}

export async function getCachedPdf(fileId: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(keyFor(fileId));
    if (!res) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function putCachedPdf(fileId: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      keyFor(fileId),
      new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } }),
    );
  } catch {
    // sem espaço / indisponível — segue sem cachear
  }
}

export async function deleteCachedPdf(fileId: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(keyFor(fileId));
  } catch {
    // ignore
  }
}

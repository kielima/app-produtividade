// Handler do Web Share Target (POST + multipart).
//
// Importado pelo SW gerado pelo vite-plugin-pwa via `workbox.importScripts`.
// Roda ANTES dos handlers do workbox, então conseguimos intercetar o POST
// pra `/share-target` (que o workbox ignora — só faz routing de GET).
//
// Estratégia: respondemos com o redirect SÍNCRONO (rápido), e processamos
// o FormData em background via waitUntil. Caso a leitura do body falhe,
// gravamos o erro no Cache pra o app mostrar no diálogo. O cliente faz
// polling do Cache por uns segundos após chegar a `/?shared=1`.

const SHARE_CACHE = 'share-target-v1';
const SHARE_PAYLOAD_URL = '/share-target/pending';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (url.pathname !== '/share-target') return;

  // Redirect imediato — não bloqueia esperando o body ser lido.
  event.respondWith(Response.redirect('/?shared=1', 303));
  event.waitUntil(processShare(event.request));
});

async function processShare(request) {
  let stage = 'init';
  try {
    stage = 'formData';
    const formData = await request.formData();

    stage = 'parse';
    const title = String(formData.get('title') ?? '');
    const text = String(formData.get('text') ?? '');
    const sharedUrl = String(formData.get('url') ?? '');

    const files = formData
      .getAll('image')
      .filter((f) => f instanceof File && f.size > 0);

    stage = 'encode';
    let image = null;
    const file = files[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Codifica em chunks pra não estourar a stack em imagens maiores.
      const CHUNK = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(
          null,
          bytes.subarray(i, i + CHUNK),
        );
      }
      image = {
        data: self.btoa(binary),
        mimeType: file.type || 'image/jpeg',
      };
    }

    stage = 'cache';
    await writePayload({ title, text, url: sharedUrl, image });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await writePayload({ error: `[${stage}] ${message}` }).catch(() => {});
  }
}

async function writePayload(payload) {
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(
    new Request(SHARE_PAYLOAD_URL),
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

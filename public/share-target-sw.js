// Handler do Web Share Target (POST + multipart).
//
// Importado pelo SW gerado pelo vite-plugin-pwa via `workbox.importScripts`.
// Roda ANTES dos handlers do workbox, então conseguimos intercetar o POST
// pra `/share-target` (que o workbox ignora — só faz routing de GET).
//
// Fluxo:
//   Android partilha → POST /share-target (multipart/form-data) →
//   este handler lê FormData, codifica a primeira imagem em base64,
//   guarda payload num Cache → redireciona pra `/?shared=1` →
//   o app lê do cache no boot e mostra o diálogo de escolha.

const SHARE_CACHE = 'share-target-v1';
const SHARE_PAYLOAD_URL = '/share-target/pending';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (url.pathname !== '/share-target') return;

  event.respondWith(handleShare(event.request));
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const title = String(formData.get('title') ?? '');
    const text = String(formData.get('text') ?? '');
    const sharedUrl = String(formData.get('url') ?? '');

    const files = formData
      .getAll('image')
      .filter((f) => f instanceof File && f.size > 0);

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

    const payload = { title, text, url: sharedUrl, image };
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      new Request(SHARE_PAYLOAD_URL),
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    return Response.redirect('/?shared=1', 303);
  } catch (err) {
    return new Response(
      `Erro ao processar partilha: ${err && err.message ? err.message : err}`,
      { status: 500 },
    );
  }
}

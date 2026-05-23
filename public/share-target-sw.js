// Handler do Web Share Target (POST + multipart).
//
// Importado pelo SW gerado pelo vite-plugin-pwa via `workbox.importScripts`.
// Roda ANTES dos handlers do workbox, então conseguimos intercetar o POST
// pra `/share-target` (que o workbox ignora — só faz routing de GET).
//
// Estratégia:
//   1. Clona o request ANTES de respondWith — sem isto, o body fica
//      inacessível em background no Android (causa do "Failed to fetch").
//   2. Responde com redirect 303 imediato.
//   3. Em waitUntil, tenta request.formData() no clone; se falhar (bug
//      conhecido do Chrome em Android partilhando imagens), faz parse
//      manual de multipart a partir do ArrayBuffer.
//   4. Grava { title, text, url, image } ou { error: '[stage] msg' } num
//      Cache; o app lê e mostra o diálogo.

const SHARE_CACHE = 'share-target-v1';
const SHARE_PAYLOAD_URL = '/share-target/pending';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (url.pathname !== '/share-target') return;

  // Clones independentes do body — um pra formData, outro pra fallback manual.
  const forFormData = event.request.clone();
  const forFallback = event.request.clone();

  event.respondWith(Response.redirect('/?shared=1', 303));
  event.waitUntil(processShare(forFormData, forFallback));
});

async function processShare(reqFormData, reqFallback) {
  let stage = 'init';
  try {
    stage = 'readBody';
    const parsed = await readBody(reqFormData, reqFallback);

    stage = 'parse';
    const title = parsed.fields.title || '';
    const text = parsed.fields.text || '';
    const sharedUrl = parsed.fields.url || '';
    const file = parsed.files.find((f) => f.fieldName === 'image') || null;

    stage = 'encode';
    let image = null;
    if (file && file.bytes.byteLength > 0) {
      image = {
        data: bytesToBase64(file.bytes),
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

// Tenta a API nativa (rápido, sem alocar ArrayBuffer extra) e cai
// pro parser manual se o Chrome rejeitar o body.
async function readBody(reqFormData, reqFallback) {
  let formDataErr;
  try {
    const fd = await reqFormData.formData();
    const fields = {};
    const files = [];
    for (const [name, value] of fd.entries()) {
      if (value instanceof File) {
        const ab = await value.arrayBuffer();
        files.push({
          fieldName: name,
          filename: value.name,
          type: value.type,
          bytes: new Uint8Array(ab),
        });
      } else {
        fields[name] = String(value);
      }
    }
    return { fields, files };
  } catch (e) {
    formDataErr = e && e.message ? e.message : String(e);
  }
  try {
    return await parseMultipartManual(reqFallback);
  } catch (e) {
    const fallbackErr = e && e.message ? e.message : String(e);
    throw new Error(`formData: ${formDataErr}; manual: ${fallbackErr}`);
  }
}

async function parseMultipartManual(request) {
  const contentType = request.headers.get('Content-Type') || '';
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('sem boundary no Content-Type');
  const boundary = (m[1] || m[2]).trim();

  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('body vazio');

  const delim = new TextEncoder().encode(`--${boundary}`);
  const positions = findAll(buf, delim);
  if (positions.length < 2) throw new Error('delimitadores insuficientes');

  const fields = {};
  const files = [];
  for (let p = 0; p < positions.length - 1; p++) {
    let start = positions[p] + delim.length;
    // CRLF depois do boundary
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    let end = positions[p + 1];
    // CRLF antes do próximo boundary
    if (end >= 2 && buf[end - 2] === 13 && buf[end - 1] === 10) end -= 2;
    if (end <= start) continue;

    // Separador cabeçalho/corpo: CRLF CRLF
    let headerEnd = -1;
    for (let k = start; k <= end - 4; k++) {
      if (
        buf[k] === 13 &&
        buf[k + 1] === 10 &&
        buf[k + 2] === 13 &&
        buf[k + 3] === 10
      ) {
        headerEnd = k;
        break;
      }
    }
    if (headerEnd === -1) continue;

    const headerText = new TextDecoder().decode(buf.subarray(start, headerEnd));
    const body = buf.subarray(headerEnd + 4, end);

    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        headers[line.slice(0, idx).toLowerCase().trim()] = line
          .slice(idx + 1)
          .trim();
      }
    }

    const cd = headers['content-disposition'] || '';
    const nameMatch = cd.match(/name="([^"]*)"/);
    const filenameMatch = cd.match(/filename="([^"]*)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    if (filenameMatch && filenameMatch[1]) {
      files.push({
        fieldName: name,
        filename: filenameMatch[1],
        type: headers['content-type'] || 'application/octet-stream',
        bytes: body,
      });
    } else {
      fields[name] = new TextDecoder().decode(body);
    }
  }
  return { fields, files };
}

function findAll(haystack, needle) {
  const positions = [];
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    positions.push(i);
    i += needle.length - 1;
  }
  return positions;
}

function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return self.btoa(binary);
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

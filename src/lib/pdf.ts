// Configuração central do pdf.js. O worker é empacotado localmente pelo Vite
// (sem CDN) para manter o PWA funcionando offline, combinando com o service
// worker já usado no app.
import * as pdfjsLib from 'pdfjs-dist';
// O sufixo ?url faz o Vite emitir o worker como asset e devolver a URL final.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLib.PDFPageProxy;

// Abre um documento PDF a partir dos bytes (ArrayBuffer/Uint8Array). pdf.js
// "consome" o buffer transferindo-o ao worker, então passamos uma cópia para
// não invalidar o original (que pode estar em cache).
export async function loadPdfDocument(
  data: ArrayBuffer | Uint8Array,
): Promise<PDFDocumentProxy> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = bytes.slice();
  const task = pdfjsLib.getDocument({ data: copy });
  return task.promise;
}

/**
 * Utilitários de imagem/arquivo usados no envio de anexos e na foto dos
 * recursos.
 *
 * Motivo de existir: no APK (WebView do Android), o seletor de arquivos às
 * vezes entrega a foto com `file.type` vazio ou genérico
 * (`application/octet-stream`), e fotos da câmera passam fácil de 10 MB.
 * Sem tratar isso, o anexo era recusado antes de sair do celular.
 */

const TIPO_POR_EXTENSAO: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/** Tipo MIME do arquivo, deduzido pela extensão quando o navegador não diz. */
export function inferirTipo(file: { name: string; type: string }): string {
  const tipo = (file.type || '').toLowerCase();
  if (tipo && tipo !== 'application/octet-stream' && !tipo.endsWith('/*')) return tipo;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TIPO_POR_EXTENSAO[ext] ?? tipo;
}

/** Imagens que o canvas consegue redesenhar (HEIC não: o Chrome não decodifica). */
export function ehImagemRedimensionavel(tipo: string): boolean {
  return tipo === 'image/png' || tipo === 'image/jpeg' || tipo === 'image/webp';
}

function carregarImagem(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

function desenhar(img: HTMLImageElement, maxLado: number, quadrado: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  if (quadrado) {
    // Corta o centro num quadrado (avatar) e reduz para maxLado×maxLado.
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - lado) / 2;
    const sy = (img.naturalHeight - lado) / 2;
    const destino = Math.min(maxLado, lado);
    canvas.width = destino;
    canvas.height = destino;
    canvas.getContext('2d')!.drawImage(img, sx, sy, lado, lado, 0, 0, destino, destino);
    return canvas;
  }
  const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * escala);
  canvas.height = Math.round(img.naturalHeight * escala);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Reduz uma foto grande para JPEG de no máximo `maxLado` px no lado maior.
 * Devolve o próprio arquivo quando não dá (ou não precisa) reduzir.
 */
export async function reduzirFoto(file: File, maxLado = 2048, limiteBytes = 1.5 * 1024 * 1024): Promise<File> {
  const tipo = inferirTipo(file);
  if (!ehImagemRedimensionavel(tipo) || file.size <= limiteBytes) return file;
  try {
    const img = await carregarImagem(file);
    const canvas = desenhar(img, maxLado, false);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nome, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Foto de avatar: corte quadrado, 256 px, como data URL JPEG (≈20–40 KB). */
export async function fotoParaAvatar(file: File, lado = 256): Promise<string> {
  const img = await carregarImagem(file);
  const canvas = desenhar(img, lado, true);
  return canvas.toDataURL('image/jpeg', 0.85);
}

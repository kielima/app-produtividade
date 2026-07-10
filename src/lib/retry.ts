// Retentativa com backoff exponencial e timeout por tentativa. Usado nas
// escritas automáticas em segundo plano (ex.: DOI/classificação detectados
// ao abrir um PDF) porque, no APK (Capacitor), o Firestore roda com cache em
// memória — uma escrita que nunca é confirmada pelo servidor (rede instável
// do WebView) fica pendurada para sempre e é perdida se o app for
// minimizado/fechado, sem nenhum aviso. Um timeout curto por tentativa evita
// ficar preso esperando uma promise que talvez nunca resolva.
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Tempo esgotado.',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 8000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}

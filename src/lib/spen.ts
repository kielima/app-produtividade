// Ponte com o botão da S-Pen na versão APK (Capacitor).
//
// O botão lateral da S-Pen não chega ao JavaScript no navegador comum. Na
// versão empacotada (Capacitor/Android), o MainActivity nativo lê o botão e
// chama `window.__spenButton(pressed)`. Aqui guardamos esse estado; no
// navegador comum a função nunca é chamada, então fica sempre `false` e não
// muda nada.

let spenButtonPressed = false;
// Instrumentação (painel de diagnóstico): conta quantas vezes a ponte nativa
// chamou e quando — permite ver no aparelho se o aviso do botão está chegando.
let nativeCallCount = 0;
let lastNativeCallAt = 0;

declare global {
  interface Window {
    __spenButton?: (pressed: boolean) => void;
    __spenErase?: (x: number, y: number) => void;
  }
}

// Contador do canal de borracha nativo (diagnóstico).
let eraseCallCount = 0;

if (typeof window !== 'undefined') {
  window.__spenButton = (pressed: boolean) => {
    spenButtonPressed = !!pressed;
    nativeCallCount++;
    lastNativeCallAt = Date.now();
  };
  // Borracha nativa: o MainActivity manda as coordenadas (px CSS, relativas à
  // janela) enquanto o botão da S-Pen está pressionado com a caneta na tela.
  // Repassamos como evento para quem estiver montado (PdfPageView) apagar —
  // caminho independente dos Pointer Events do WebView, que em alguns
  // aparelhos cancelam o traço quando o botão do stylus está pressionado.
  window.__spenErase = (x: number, y: number) => {
    eraseCallCount++;
    window.dispatchEvent(
      new CustomEvent('spen-erase', { detail: { x, y } }),
    );
  };
}

export function isSpenButtonPressed(): boolean {
  return spenButtonPressed;
}

export function getSpenDebug(): {
  pressed: boolean;
  nativeCallCount: number;
  lastNativeCallAt: number;
  eraseCallCount: number;
} {
  return {
    pressed: spenButtonPressed,
    nativeCallCount,
    lastNativeCallAt,
    eraseCallCount,
  };
}

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
  }
}

if (typeof window !== 'undefined') {
  window.__spenButton = (pressed: boolean) => {
    spenButtonPressed = !!pressed;
    nativeCallCount++;
    lastNativeCallAt = Date.now();
  };
}

export function isSpenButtonPressed(): boolean {
  return spenButtonPressed;
}

export function getSpenDebug(): {
  pressed: boolean;
  nativeCallCount: number;
  lastNativeCallAt: number;
} {
  return { pressed: spenButtonPressed, nativeCallCount, lastNativeCallAt };
}

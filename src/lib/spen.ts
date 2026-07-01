// Ponte com o botão da S-Pen na versão APK (Capacitor).
//
// O botão lateral da S-Pen não chega ao JavaScript no navegador comum. Na
// versão empacotada (Capacitor/Android), o MainActivity nativo lê o botão e
// chama `window.__spenButton(pressed)`. Aqui guardamos esse estado; no
// navegador comum a função nunca é chamada, então fica sempre `false` e não
// muda nada.

let spenButtonPressed = false;

declare global {
  interface Window {
    __spenButton?: (pressed: boolean) => void;
  }
}

if (typeof window !== 'undefined') {
  window.__spenButton = (pressed: boolean) => {
    spenButtonPressed = !!pressed;
  };
}

export function isSpenButtonPressed(): boolean {
  return spenButtonPressed;
}

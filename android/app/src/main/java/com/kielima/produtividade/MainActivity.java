package com.kielima.produtividade;

import android.view.MotionEvent;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * Ponte do botão da S-Pen para o WebView.
 *
 * O botão lateral da S-Pen NÃO é exposto ao JavaScript no navegador/WebView,
 * mas ESTÁ disponível no nível nativo via {@link MotionEvent#getButtonState()}.
 * Lemos o estado do botão nos eventos que a Activity recebe ANTES de repassá-los
 * ao WebView (touch e hover) e, quando o estado muda, avisamos o app web
 * chamando {@code window.__spenButton(pressed)}. O lado web (src/lib/spen.ts)
 * usa isso para ativar a borracha, como no Samsung Notes.
 */
public class MainActivity extends BridgeActivity {

    private boolean spenButtonDown = false;

    private boolean isStylusButtonPressed(MotionEvent ev) {
        int state = ev.getButtonState();
        return (state & MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
            || (state & MotionEvent.BUTTON_STYLUS_SECONDARY) != 0
            || (state & MotionEvent.BUTTON_SECONDARY) != 0;
    }

    private void notifySpenButton(MotionEvent ev) {
        boolean pressed = isStylusButtonPressed(ev);
        if (pressed == spenButtonDown) return;
        spenButtonDown = pressed;
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        final String js = "window.__spenButton && window.__spenButton(" + (pressed ? "true" : "false") + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        notifySpenButton(ev);
        return super.dispatchTouchEvent(ev);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        // Cobre o HOVER da caneta: a S-Pen paira (com o botão já pressionado)
        // antes de encostar, então a borracha fica pronta antes do traço.
        notifySpenButton(ev);
        return super.dispatchGenericMotionEvent(ev);
    }
}

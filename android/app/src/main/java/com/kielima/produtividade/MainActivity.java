package com.kielima.produtividade;

import android.view.MotionEvent;
import android.view.View;
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

    /**
     * Borracha 100% nativa: enquanto o botão da S-Pen está pressionado e a
     * caneta TOCA a tela, mandamos as coordenadas (em px CSS) direto para o
     * app web apagar. Isso não depende do fluxo de Pointer Events do WebView —
     * que em alguns aparelhos cancela/segura o traço quando o botão do stylus
     * está pressionado, deixando a borracha muda mesmo com a ponte do botão
     * funcionando.
     */
    private void notifySpenErase(MotionEvent ev) {
        if (!isStylusButtonPressed(ev)) return;
        int action = ev.getActionMasked();
        if (action != MotionEvent.ACTION_DOWN && action != MotionEvent.ACTION_MOVE) return;
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        // px físicos → px CSS (o WebView usa density como devicePixelRatio).
        float density = getResources().getDisplayMetrics().density;
        final float x = ev.getX() / density;
        final float y = ev.getY() / density;
        final String js = "window.__spenErase && window.__spenErase(" + x + "," + y + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    // Oculta a barra de status (topo) para leitura em tela cheia. Mantém a
    // barra de navegação. IMMERSIVE_STICKY faz a barra reaparecer só
    // temporariamente ao deslizar da borda superior, voltando a esconder.
    private void hideStatusBar() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Reaplica ao voltar o foco (ex.: depois de puxar a barra ou trocar de app).
        if (hasFocus) {
            hideStatusBar();
        }
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        notifySpenButton(ev);
        notifySpenErase(ev);
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

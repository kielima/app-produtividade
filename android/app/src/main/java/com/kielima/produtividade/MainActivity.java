package com.kielima.produtividade;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.kielima.produtividade.atualizador.AtualizadorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.Executors;

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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin nativo do verificador de atualização in-app (baixa o APK da
        // build publicada e abre o instalador). Registrado ANTES do super para
        // o bridge do Capacitor já o conhecer ao inicializar.
        registerPlugin(AtualizadorPlugin.class);
        super.onCreate(savedInstanceState);
        fixWebViewTextScale();
        handleShareIntent(getIntent());
    }

    // O app roda em singleTask: se já estiver aberto, um novo compartilhamento
    // chega aqui em vez de onCreate.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    /**
     * Recebe links/texto/imagens compartilhados de outros apps via o menu
     * "Compartilhar" do Android (ACTION_SEND, registrado no
     * AndroidManifest.xml). Texto/links repassam pro app web navegando o
     * WebView pra URL atual com os dados na query string — o app web já lê
     * esse formato, é o mesmo fluxo legado do Web Share Target (ver
     * src/main.tsx). Imagens vão por {@link #handleImageShare}, já que o
     * conteúdo (base64) é grande demais pra caber numa query string.
     */
    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String type = intent.getType();
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || type == null) return;

        if (type.startsWith("image/")) {
            handleImageShare(intent);
            return;
        }
        if (!type.startsWith("text/")) return;

        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);

        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;

        String current = webView.getUrl();
        Uri base = Uri.parse(current != null && !current.isEmpty() ? current : "https://localhost/");
        Uri.Builder target = base.buildUpon().path("/").clearQuery();
        target.appendQueryParameter("native_share", "1");
        target.appendQueryParameter("text", text);
        if (subject != null && !subject.isEmpty()) {
            target.appendQueryParameter("title", subject);
        }
        final String url = target.build().toString();
        webView.post(() -> webView.loadUrl(url));
    }

    /**
     * Lê a imagem (EXTRA_STREAM) do intent de compartilhamento, converte pra
     * base64 e entrega ao app web via sessionStorage — o mesmo formato
     * `pendingShare` do fluxo de texto acima, mas com o campo `image`
     * preenchido (ver App.tsx#readLegacyPayload). Como o payload pode ter
     * vários MB, vai via injeção de JS em vez de query string (que tem limite
     * de tamanho) e depois recarrega a URL pra disparar a leitura do payload
     * no mount do app. A leitura do arquivo e a codificação base64 rodam fora
     * da thread principal — imagens de câmera facilmente passam de alguns MB
     * e fariam o app travar (ANR) se lidas de forma síncrona no onCreate.
     */
    private void handleImageShare(Intent intent) {
        Uri imageUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (imageUri == null) return;

        String mimeType = intent.getType();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);

        Executors.newSingleThreadExecutor().execute(() -> {
            byte[] bytes;
            try (InputStream in = getContentResolver().openInputStream(imageUri)) {
                if (in == null) return;
                bytes = readAllBytes(in);
            } catch (IOException e) {
                return;
            }
            if (bytes.length == 0) return;

            JSONObject payload = new JSONObject();
            try {
                payload.put("title", subject != null ? subject : "");
                payload.put("text", text != null ? text : "");
                payload.put("url", "");
                JSONObject image = new JSONObject();
                image.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                image.put("mimeType", mimeType != null ? mimeType : "image/jpeg");
                payload.put("image", image);
            } catch (JSONException e) {
                return;
            }

            if (getBridge() == null) return;
            final WebView webView = getBridge().getWebView();
            if (webView == null) return;

            String current = webView.getUrl();
            Uri base = Uri.parse(current != null && !current.isEmpty() ? current : "https://localhost/");
            final String url = base.buildUpon().path("/").clearQuery().build().toString();
            final String js = "sessionStorage.setItem('pendingShare', " + JSONObject.quote(payload.toString()) + ");";
            webView.post(() -> webView.evaluateJavascript(js, value -> webView.loadUrl(url)));
        });
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /**
     * O WebView segue a escala de fonte de acessibilidade do sistema
     * (textZoom = fontScale × 100). Isso infla TODO o texto do DOM (~14% num
     * Samsung com fonte "grande") sem afetar o canvas — a camada de texto do
     * pdf.js fica mais larga que os glifos desenhados e o marca-texto sai
     * desalinhado (pdf.js issues #12243/#14426; o contorno interno do pdf.js
     * cobre só o "minimum font size" estrito, não o text zoom do WebView).
     * Fixamos o zoom de texto em 100% e o font size mínimo em 1px: o DOM
     * passa a medir exatamente o que o pdf.js calculou.
     */
    private void fixWebViewTextScale() {
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.getSettings().setTextZoom(100);
        webView.getSettings().setMinimumFontSize(1);
        webView.getSettings().setMinimumLogicalFontSize(1);
    }

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

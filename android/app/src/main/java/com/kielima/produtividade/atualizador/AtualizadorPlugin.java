package com.kielima.produtividade.atualizador;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

// Baixa o APK da última build publicada e abre o instalador do Android.
// O download usa o DownloadManager do sistema (segue os redirects, mostra
// progresso na barra de notificações e grava no diretório externo do próprio
// app — sem precisar de permissão de armazenamento). Ao terminar, dispara o
// instalador via FileProvider. No Android O+ o sistema pede ao usuário para
// permitir "instalar apps desconhecidos" deste app na primeira vez.
@CapacitorPlugin(name = "Atualizador")
public class AtualizadorPlugin extends Plugin {

    private static final String ARQUIVO = "produtividade.apk";
    private static final String MIME_APK = "application/vnd.android.package-archive";

    @PluginMethod
    public void baixarEInstalar(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL da atualização ausente");
            return;
        }

        final Context ctx = getContext();
        final File destino =
            new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), ARQUIVO);
        // DownloadManager não sobrescreve: cria "produtividade-1.apk" etc. Remove a sobra.
        if (destino.exists()) {
            destino.delete();
        }

        final DownloadManager dm =
            (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            call.reject("Gerenciador de downloads indisponível");
            return;
        }

        DownloadManager.Request req;
        try {
            req = new DownloadManager.Request(Uri.parse(url));
        } catch (Exception e) {
            call.reject("URL inválida", e);
            return;
        }
        req.setTitle("Produtividade — atualização");
        req.setDescription("Baixando nova versão");
        req.setMimeType(MIME_APK);
        req.setNotificationVisibility(
            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalFilesDir(
            ctx, Environment.DIRECTORY_DOWNLOADS, ARQUIVO);

        final long id = dm.enqueue(req);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                long recebido =
                    intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (recebido != id) return;
                try {
                    c.unregisterReceiver(this);
                } catch (Exception ignored) {
                }

                if (consultarStatus(dm, id) != DownloadManager.STATUS_SUCCESSFUL) {
                    call.reject("Falha ao baixar a atualização");
                    return;
                }
                try {
                    abrirInstalador(ctx, destino);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Falha ao abrir o instalador", e);
                }
            }
        };

        // ACTION_DOWNLOAD_COMPLETE é um broadcast do sistema: no Android 13+ o
        // receiver dinâmico precisa declarar exportado.
        ContextCompat.registerReceiver(
            ctx,
            receiver,
            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED);
    }

    private static int consultarStatus(DownloadManager dm, long id) {
        DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
        Cursor cur = dm.query(q);
        try {
            if (cur != null && cur.moveToFirst()) {
                int i = cur.getColumnIndex(DownloadManager.COLUMN_STATUS);
                if (i >= 0) return cur.getInt(i);
            }
        } finally {
            if (cur != null) cur.close();
        }
        return -1;
    }

    private static void abrirInstalador(Context ctx, File apk) {
        Uri uri = FileProvider.getUriForFile(
            ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, MIME_APK);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }
}

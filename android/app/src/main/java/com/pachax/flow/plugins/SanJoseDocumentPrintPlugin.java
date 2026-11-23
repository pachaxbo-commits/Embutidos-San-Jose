package com.pachax.flow.plugins;

import android.os.Bundle;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.OutputStream;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SanJoseDocumentPrint")
public class SanJoseDocumentPrintPlugin extends Plugin {
    @PluginMethod
    public void savePdf(PluginCall call) {
        String filename = call.getString("filename", "");
        String data = call.getString("data", "");
        if (!filename.matches("[a-zA-Z0-9_-]+[.]pdf") || data.isEmpty()) {
            call.reject("No se recibió un PDF válido para guardar.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "writePdf");
    }

    @ActivityCallback
    private void writePdf(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (stream == null) throw new IllegalStateException("No se pudo abrir el destino");
            stream.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
        } catch (Exception error) {
            call.reject("No se pudo guardar el PDF en la ubicación seleccionada.", error);
            return;
        }
        call.resolve(new JSObject().put("saved", true));
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html", "");
        String jobName = call.getString("jobName", "Comprobante San Jose");
        if (html.trim().isEmpty()) {
            call.reject("No se recibió el documento para imprimir.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView printWebView = new WebView(getContext());
            printWebView.getSettings().setJavaScriptEnabled(false);
            Handler timeout = new Handler(Looper.getMainLooper());
            Runnable failIfNotLoaded = () -> {
                printWebView.destroy();
                call.reject("El documento tardó demasiado en prepararse para imprimir.");
            };
            timeout.postDelayed(failIfNotLoaded, 15000);

            printWebView.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (started) return;
                    started = true;
                    timeout.removeCallbacks(failIfNotLoaded);
                    PrintManager manager = (PrintManager) getContext().getSystemService(android.content.Context.PRINT_SERVICE);
                    if (manager == null) {
                        view.destroy();
                        call.reject("Android no tiene disponible el servicio de impresión.");
                        return;
                    }
                    PrintDocumentAdapter delegate = view.createPrintDocumentAdapter(jobName);
                    PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                        @Override public void onStart() { delegate.onStart(); }
                        @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancellationSignal, LayoutResultCallback callback, Bundle extras) {
                            delegate.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras);
                        }
                        @Override public void onWrite(android.print.PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal cancellationSignal, WriteResultCallback callback) {
                            delegate.onWrite(pages, destination, cancellationSignal, callback);
                        }
                        @Override public void onFinish() {
                            try { delegate.onFinish(); } finally { view.destroy(); }
                        }
                    };
                    manager.print(jobName, adapter, new PrintAttributes.Builder().build());
                    JSObject result = new JSObject();
                    result.put("opened", true);
                    call.resolve(result);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (!request.isForMainFrame() || started) return;
                    started = true;
                    timeout.removeCallbacks(failIfNotLoaded);
                    view.destroy();
                    call.reject("No se pudo preparar el documento para imprimir.");
                }
            });
            printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}

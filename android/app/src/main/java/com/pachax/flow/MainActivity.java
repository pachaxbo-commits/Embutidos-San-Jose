package com.pachax.flow;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.pachax.flow.plugins.PachaxBluetoothPermissionsPlugin;
import com.pachax.flow.plugins.PachaxBluetoothPrinterPlugin;
import com.pachax.flow.plugins.PachaxTcpSocketPlugin;
import com.pachax.flow.plugins.SanJoseUpdaterPlugin;
import com.pachax.flow.plugins.SanJoseDocumentPrintPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PachaxBluetoothPermissionsPlugin.class);
        registerPlugin(PachaxBluetoothPrinterPlugin.class);
        registerPlugin(PachaxTcpSocketPlugin.class);
        registerPlugin(SanJoseUpdaterPlugin.class);
        registerPlugin(SanJoseDocumentPrintPlugin.class);
        super.onCreate(savedInstanceState);
        // Auth/Firestore Emulator use local plain HTTP. Allow it only in debug
        // builds; official Release WebView keeps its default mixed-content
        // policy and never receives an Emulator endpoint.
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebuggable && getBridge() != null) {
            WebView webView = getBridge().getWebView();
            webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}

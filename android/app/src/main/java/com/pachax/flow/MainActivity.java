package com.pachax.flow;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.pachax.flow.plugins.PachaxBluetoothPermissionsPlugin;
import com.pachax.flow.plugins.PachaxBluetoothPrinterPlugin;
import com.pachax.flow.plugins.PachaxTcpSocketPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PachaxBluetoothPermissionsPlugin.class);
        registerPlugin(PachaxBluetoothPrinterPlugin.class);
        registerPlugin(PachaxTcpSocketPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

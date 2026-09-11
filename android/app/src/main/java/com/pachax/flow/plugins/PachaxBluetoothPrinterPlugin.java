package com.pachax.flow.plugins;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Transporte Bluetooth SPP dedicado a impresoras. No abre un hilo de lectura. */
@CapacitorPlugin(name = "PachaxBluetoothPrinter")
public class PachaxBluetoothPrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private OutputStream outputStream;

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean hasConnectPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getState(PluginCall call) {
        try {
            BluetoothAdapter bluetooth = adapter();
            JSObject result = new JSObject();
            result.put("enabled", bluetooth != null && hasConnectPermission() && bluetooth.isEnabled());
            result.put("connected", socket != null && socket.isConnected() && outputStream != null);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo consultar Bluetooth: " + safeMessage(error), error);
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (!hasConnectPermission()) {
            call.reject("Falta el permiso para conectar dispositivos Bluetooth.", "BLUETOOTH_PERMISSION");
            return;
        }
        try {
            BluetoothAdapter bluetooth = adapter();
            if (bluetooth == null || !bluetooth.isEnabled()) {
                call.reject("Bluetooth está apagado.", "BLUETOOTH_DISABLED");
                return;
            }
            Set<BluetoothDevice> paired = bluetooth.getBondedDevices();
            JSArray devices = new JSArray();
            for (BluetoothDevice device : paired) {
                JSObject item = new JSObject();
                item.put("id", device.getAddress());
                item.put("address", device.getAddress());
                item.put("name", device.getName() == null ? "Dispositivo Bluetooth" : device.getName());
                if (device.getBluetoothClass() != null) item.put("class", device.getBluetoothClass().getDeviceClass());
                devices.put(item);
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudieron leer los dispositivos vinculados: " + safeMessage(error), error);
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address", "").trim();
        if (!address.matches("(?i)([0-9A-F]{2}:){5}[0-9A-F]{2}")) {
            call.reject("La dirección Bluetooth no es válida.", "INVALID_ADDRESS");
            return;
        }
        if (!hasConnectPermission()) {
            call.reject("Falta el permiso para conectar dispositivos Bluetooth.", "BLUETOOTH_PERMISSION");
            return;
        }
        executor.execute(() -> {
            try {
                BluetoothAdapter bluetooth = adapter();
                if (bluetooth == null || !bluetooth.isEnabled()) throw new IOException("Bluetooth está apagado");
                closeConnection();
                bluetooth.cancelDiscovery();
                BluetoothDevice device = bluetooth.getRemoteDevice(address);
                Exception secureError;
                try {
                    BluetoothSocket candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    candidate.connect();
                    socket = candidate;
                    secureError = null;
                } catch (Exception error) {
                    secureError = error;
                    closeConnection();
                    BluetoothSocket candidate = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    candidate.connect();
                    socket = candidate;
                }
                outputStream = socket.getOutputStream();
                JSObject result = new JSObject();
                result.put("connected", true);
                call.resolve(result);
            } catch (Exception error) {
                closeConnection();
                call.reject("No se pudo abrir el canal serial de la impresora: " + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        String encoded = call.getString("dataBase64", "");
        executor.execute(() -> {
            try {
                if (socket == null || !socket.isConnected() || outputStream == null) throw new IOException("la impresora no está conectada");
                byte[] data = Base64.decode(encoded, Base64.DEFAULT);
                outputStream.write(data);
                outputStream.flush();
                JSObject result = new JSObject();
                result.put("bytesWritten", data.length);
                call.resolve(result);
            } catch (Exception error) {
                closeConnection();
                call.reject("No se pudo enviar el ticket: " + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        executor.execute(() -> {
            closeConnection();
            JSObject result = new JSObject();
            result.put("disconnected", true);
            call.resolve(result);
        });
    }

    private synchronized void closeConnection() {
        if (outputStream != null) {
            try { outputStream.close(); } catch (IOException ignored) {}
        }
        if (socket != null) {
            try { socket.close(); } catch (IOException ignored) {}
        }
        outputStream = null;
        socket = null;
    }

    private String safeMessage(Exception error) {
        return error.getMessage() == null || error.getMessage().isBlank() ? error.getClass().getSimpleName() : error.getMessage();
    }

    @Override
    protected void handleOnDestroy() {
        closeConnection();
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}

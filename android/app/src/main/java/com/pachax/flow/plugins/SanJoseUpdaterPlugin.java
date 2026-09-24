package com.pachax.flow.plugins;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "SanJoseUpdater")
public class SanJoseUpdaterPlugin extends Plugin {
    private static final String EXPECTED_PACKAGE = "com.pachax.flow";
    private static final String APK_PATH_PREFIX = "/updates/san-jose/apk/";
    private static final Set<String> TRUSTED_HOSTS = Set.of("pachax-flow.web.app", "pachax-flow.firebaseapp.com");
    private static final long MAX_APK_BYTES = 500L * 1024L * 1024L;
    private static final int BUFFER_SIZE = 64 * 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile File verifiedApk;

    @Override
    protected void handleOnDestroy() {
        cancelled.set(true);
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            call.resolve(versionResult(getInstalledPackageInfo()));
        } catch (Exception error) {
            call.reject("No se pudo comprobar la versión instalada.", error);
        }
    }

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("opened", false);
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo abrir el permiso para instalar la actualización.", error);
        }
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String rawUrl = call.getString("url", "");
        Double expectedSizeValue = call.getDouble("expectedSizeBytes");
        if (
            expectedSizeValue == null ||
            !Double.isFinite(expectedSizeValue) ||
            expectedSizeValue <= 0 ||
            expectedSizeValue > MAX_APK_BYTES ||
            expectedSizeValue != Math.rint(expectedSizeValue)
        ) {
            call.reject("El tamaño esperado de la actualización no es válido.");
            return;
        }
        long expectedSize = expectedSizeValue.longValue();
        final URL trustedUrl;
        try {
            trustedUrl = validateTrustedUrl(rawUrl);
        } catch (Exception error) {
            call.reject("La descarga no pertenece al servidor autorizado de San José.");
            return;
        }

        cancelled.set(false);
        verifiedApk = null;
        executor.execute(() -> {
            File target = null;
            HttpURLConnection connection = null;
            try {
                File directory = updateDirectory();
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("No se pudo preparar la carpeta de descarga.");
                File[] previousDownloads = directory.listFiles((ignored, name) -> name.endsWith(".apk"));
                if (previousDownloads != null) {
                    for (File previous : previousDownloads) deleteQuietly(previous);
                }
                target = new File(directory, "san-jose-actualizacion-" + System.currentTimeMillis() + ".apk");
                URL currentUrl = trustedUrl;
                for (int redirects = 0; redirects <= 3; redirects++) {
                    connection = (HttpURLConnection) currentUrl.openConnection();
                    connection.setConnectTimeout(15_000);
                    connection.setReadTimeout(30_000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
                    connection.connect();
                    int status = connection.getResponseCode();
                    if (status >= 300 && status < 400) {
                        String location = connection.getHeaderField("Location");
                        connection.disconnect();
                        connection = null;
                        currentUrl = validateTrustedUrl(new URL(currentUrl, location).toString());
                        continue;
                    }
                    if (status != HttpURLConnection.HTTP_OK) throw new IllegalStateException("El servidor respondió " + status + ".");
                    break;
                }
                if (connection == null || connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("La descarga excedió el límite de redirecciones.");
                }
                long serverSize = connection.getContentLengthLong();
                if (serverSize > 0 && serverSize != expectedSize) throw new SecurityException("El tamaño del archivo no coincide con el publicado.");

                long downloaded = 0;
                long lastProgressAt = 0;
                try (InputStream input = new BufferedInputStream(connection.getInputStream(), BUFFER_SIZE);
                     BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(target), BUFFER_SIZE)) {
                    byte[] buffer = new byte[BUFFER_SIZE];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelled.get()) throw new InterruptedException("Descarga cancelada.");
                        downloaded += count;
                        if (downloaded > expectedSize || downloaded > MAX_APK_BYTES) throw new SecurityException("La descarga supera el tamaño publicado.");
                        output.write(buffer, 0, count);
                        long now = System.currentTimeMillis();
                        if (now - lastProgressAt >= 200) {
                            notifyProgress(downloaded, expectedSize);
                            lastProgressAt = now;
                        }
                    }
                }
                if (downloaded != expectedSize) throw new SecurityException("La descarga quedó incompleta.");
                notifyProgress(downloaded, expectedSize);
                JSObject result = new JSObject();
                result.put("filePath", target.getAbsolutePath());
                result.put("sizeBytes", downloaded);
                call.resolve(result);
            } catch (InterruptedException error) {
                if (target != null) deleteQuietly(target);
                call.reject("La descarga fue cancelada.", "DOWNLOAD_CANCELLED", error);
            } catch (Exception error) {
                if (target != null) deleteQuietly(target);
                call.reject("No se pudo descargar la actualización: " + safeMessage(error), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelled.set(true);
        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void verifyApk(PluginCall call) {
        String filePath = call.getString("filePath", "");
        String expectedSha256 = call.getString("expectedSha256", "").replace(":", "").toLowerCase(Locale.ROOT);
        Double expectedVersionCodeValue = call.getDouble("expectedVersionCode");
        if (
            !expectedSha256.matches("[a-f0-9]{64}") ||
            expectedVersionCodeValue == null ||
            !Double.isFinite(expectedVersionCodeValue) ||
            expectedVersionCodeValue <= 0 ||
            expectedVersionCodeValue != Math.rint(expectedVersionCodeValue)
        ) {
            call.reject("Los datos de verificación no son válidos.");
            return;
        }
        long expectedVersionCode = expectedVersionCodeValue.longValue();
        executor.execute(() -> {
            File apk = null;
            try {
                apk = validatedUpdateFile(filePath);
                String actualSha256 = sha256(apk);
                if (!MessageDigest.isEqual(expectedSha256.getBytes(), actualSha256.getBytes())) {
                    throw new SecurityException("El archivo descargado no coincide con el SHA-256 publicado.");
                }

                PackageInfo archive = getArchivePackageInfo(apk);
                if (archive == null || !EXPECTED_PACKAGE.equals(archive.packageName)) throw new SecurityException("La APK pertenece a otra aplicación.");
                long archiveVersion = versionCode(archive);
                long installedVersion = versionCode(getInstalledPackageInfo());
                if (archiveVersion != expectedVersionCode || archiveVersion <= installedVersion) throw new SecurityException("La versión descargada no puede actualizar esta instalación.");

                String archiveCertificate = certificateSha256(archive);
                String installedCertificate = certificateSha256(getInstalledPackageInfo());
                if (!MessageDigest.isEqual(archiveCertificate.getBytes(), installedCertificate.getBytes())) {
                    throw new SecurityException("La APK no está firmada con el certificado autorizado.");
                }

                verifiedApk = apk;
                JSObject result = versionResult(archive);
                result.put("filePath", apk.getAbsolutePath());
                result.put("sha256", actualSha256);
                result.put("verified", true);
                call.resolve(result);
            } catch (Exception error) {
                if (apk != null) deleteQuietly(apk);
                verifiedApk = null;
                call.reject("La actualización fue rechazada: " + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        try {
            File apk = validatedUpdateFile(call.getString("filePath", ""));
            if (verifiedApk == null || !verifiedApk.getCanonicalPath().equals(apk.getCanonicalPath())) {
                call.reject("La APK debe verificarse antes de instalarla.");
                return;
            }
            if (!canRequestPackageInstalls()) {
                call.reject("Android todavía no autorizó la instalación desde esta aplicación.", "INSTALL_PERMISSION_REQUIRED");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo abrir el instalador de Android.", error);
        }
    }

    @PluginMethod
    public void deleteUpdate(PluginCall call) {
        try {
            File apk = validatedUpdateFile(call.getString("filePath", ""));
            if (verifiedApk != null && verifiedApk.getCanonicalPath().equals(apk.getCanonicalPath())) verifiedApk = null;
            JSObject result = new JSObject();
            result.put("deleted", !apk.exists() || apk.delete());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo eliminar el archivo de actualización.", error);
        }
    }

    private boolean canRequestPackageInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private File updateDirectory() {
        File externalFiles = getContext().getExternalFilesDir(null);
        if (externalFiles == null) throw new IllegalStateException("Android no habilitó el almacenamiento privado de la aplicación.");
        return new File(externalFiles, "Download/updates");
    }

    private File validatedUpdateFile(String rawPath) throws Exception {
        File directory = updateDirectory().getCanonicalFile();
        File file = new File(rawPath).getCanonicalFile();
        if (!file.getParentFile().equals(directory) || !file.getName().endsWith(".apk") || !file.isFile()) {
            throw new SecurityException("La ruta del archivo no es válida.");
        }
        return file;
    }

    private URL validateTrustedUrl(String rawUrl) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !TRUSTED_HOSTS.contains(url.getHost().toLowerCase(Locale.ROOT)) ||
            !url.getPath().startsWith(APK_PATH_PREFIX) || !url.getPath().endsWith(".apk") || url.getUserInfo() != null || url.getPort() != -1) {
            throw new SecurityException("Servidor no autorizado.");
        }
        return url;
    }

    private void notifyProgress(long downloaded, long total) {
        JSObject progress = new JSObject();
        progress.put("bytesDownloaded", downloaded);
        progress.put("totalBytes", total);
        progress.put("percent", Math.min(100, Math.round(downloaded * 100.0 / total)));
        notifyListeners("downloadProgress", progress);
    }

    private PackageInfo getInstalledPackageInfo() throws PackageManager.NameNotFoundException {
        PackageManager manager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        }
        return manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
    }

    private PackageInfo getArchivePackageInfo(File apk) {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        return getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), flags);
    }

    @SuppressWarnings("deprecation")
    private long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private Signature firstSignature(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            Signature[] signatures = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
            return signatures != null && signatures.length > 0 ? signatures[0] : null;
        }
        return info.signatures != null && info.signatures.length > 0 ? info.signatures[0] : null;
    }

    private String certificateSha256(PackageInfo info) throws Exception {
        Signature signature = firstSignature(info);
        if (signature == null) throw new SecurityException("La APK no contiene un certificado verificable.");
        return hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()));
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file), BUFFER_SIZE)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    private String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    private JSObject versionResult(PackageInfo info) throws Exception {
        JSObject result = new JSObject();
        result.put("packageName", info.packageName);
        result.put("versionCode", versionCode(info));
        result.put("versionName", info.versionName == null ? "" : info.versionName);
        result.put("certificateSha256", certificateSha256(info));
        return result;
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? "error inesperado" : message;
    }

    private void deleteQuietly(File file) {
        try { if (file.exists()) file.delete(); } catch (Exception ignored) { /* sin efecto */ }
    }
}

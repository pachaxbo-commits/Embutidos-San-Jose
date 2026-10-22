package com.pachax.flow.plugins;

/** Strict certificate selection shared by the APK archive and installed-app checks. */
final class UpdaterCertificateReader {
    private UpdaterCertificateReader() {}

    static byte[] selectCertificate(byte[] signingInfoCertificate, byte[] legacySignature, String source) {
        if (signingInfoCertificate != null && signingInfoCertificate.length > 0) {
            return signingInfoCertificate.clone();
        }
        if (legacySignature != null && legacySignature.length > 0) return legacySignature.clone();
        throw new SecurityException(
            "No se pudo leer el certificado de la " + source +
            "; Android no devolvió SigningInfo ni firmas."
        );
    }
}

package com.pachax.flow.plugins;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class UpdaterCertificateReaderTest {
    @Test
    public void prefersSigningInfoWhenBothCertificateSourcesArePresent() {
        byte[] signingInfo = new byte[] {1, 2, 3};
        byte[] legacy = new byte[] {4, 5, 6};

        assertArrayEquals(signingInfo, UpdaterCertificateReader.selectCertificate(signingInfo, legacy, "APK descargada"));
    }

    @Test
    public void fallsBackToLegacySignaturesWhenSigningInfoIsMissing() {
        byte[] legacy = new byte[] {4, 5, 6};

        assertArrayEquals(legacy, UpdaterCertificateReader.selectCertificate(null, legacy, "APK descargada"));
    }

    @Test
    public void fallsBackToLegacySignaturesWhenSigningInfoIsEmpty() {
        byte[] legacy = new byte[] {4, 5, 6};

        assertArrayEquals(legacy, UpdaterCertificateReader.selectCertificate(new byte[0], legacy, "aplicación instalada"));
    }

    @Test
    public void rejectsMissingArchiveCertificateWithSpecificMessage() {
        assertMissingCertificateMessage("APK descargada", "certificado de la APK descargada");
    }

    @Test
    public void rejectsMissingInstalledCertificateWithSpecificMessage() {
        assertMissingCertificateMessage("aplicación instalada", "certificado de la aplicación instalada");
    }

    @Test
    public void rejectsEmptyCertificateInsteadOfWeakeningSignatureValidation() {
        assertMissingCertificateMessage("APK descargada", "Android no devolvió SigningInfo ni firmas");
    }

    @Test
    public void rejectsEmptyModernAndLegacyCertificateSources() {
        assertMissingCertificateMessage("aplicación instalada", "certificado de la aplicación instalada", new byte[0], new byte[0]);
    }

    private static void assertMissingCertificateMessage(String source, String expectedText) {
        assertMissingCertificateMessage(source, expectedText, null, null);
    }

    private static void assertMissingCertificateMessage(String source, String expectedText, byte[] modern, byte[] legacy) {
        try {
            UpdaterCertificateReader.selectCertificate(modern, legacy, source);
            fail("A missing certificate must be rejected.");
        } catch (SecurityException error) {
            assertTrue(error.getMessage().contains(expectedText));
        }
    }
}

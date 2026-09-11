import { Capacitor } from "@capacitor/core";
export async function saveReport(
  bytes: Uint8Array,
  filename: string,
  mime: string,
) {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const file = await Filesystem.writeFile({
      directory: Directory.Cache,
      path: `reports/${filename}`,
      data: btoa(binary),
      recursive: true,
    });
    await Share.share({
      title: filename,
      files: [file.uri],
      dialogTitle: "Guardar o abrir reporte",
    });
  } else {
    const blob = new Blob([new Uint8Array(bytes).buffer], { type: mime }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

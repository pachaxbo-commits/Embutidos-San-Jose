import { readFile } from 'node:fs/promises'

const receipt = await readFile('src/modules/distribution/data/distributionReceiptService.ts', 'utf8')
const collectionPayload = await readFile('src/modules/distribution/domain/collectionReceiptPayload.ts', 'utf8')
const printService = await readFile('src/services/printing/documentPrintService.ts', 'utf8')
const distributionPrintService = await readFile('src/modules/distribution/data/distributionDocumentPrintService.ts', 'utf8')
const closureView = await readFile('src/modules/distribution/views/ClosureView.tsx', 'utf8')
const printPlugin = await readFile('android/app/src/main/java/com/pachax/flow/plugins/SanJoseDocumentPrintPlugin.java', 'utf8')
const manifest = await readFile('android/app/src/main/AndroidManifest.xml', 'utf8')
const androidBuild = await readFile('android/app/build.gradle', 'utf8')
const updatePreparation = await readFile('scripts/prepare-android-update.mjs', 'utf8')

assert(receipt.includes('Filesystem.writeFile'), 'Compartir Android debe crear el PNG en caché privada.')
assert(receipt.includes('Share.share'), 'Compartir Android debe utilizar Capacitor Share.')
assert(receipt.includes('Directory.Cache'), 'El recibo compartido debe ser temporal.')
assert(receipt.includes('withTimeout'), 'Compartir debe controlar promesas que no responden.')
assert(receipt.includes('printCollectionReceipt'), 'Los cobros deben reutilizar el motor térmico real.')
assert(receipt.includes('shareCollectionReceipt'), 'Los cobros deben poder compartirse desde Android.')
assert(collectionPayload.includes('COMPROBANTE DE COBRO'), 'El ticket debe identificarse como comprobante de cobro.')
assert(!collectionPayload.includes('COMPROBANTE DE VENTA'), 'El ticket de cobro no debe presentarse como venta.')
assert(manifest.includes('androidx.core.content.FileProvider'), 'Android debe exponer archivos mediante FileProvider/content URI.')
assert(printService.includes("registerPlugin<SanJoseDocumentPrintPlugin>('SanJoseDocumentPrint')"), 'La impresión debe utilizar el plugin nativo dedicado.')
assert(printService.includes("Capacitor.isPluginAvailable('SanJoseDocumentPrint')"), 'Debe detectar versiones nativas sin el plugin de descarga directa.')
assert(distributionPrintService.includes("await shareClosurePdf(closure)"), 'Una app Android antigua debe ofrecer Compartir PDF si falta el selector nativo.')
assert(closureView.includes('Se abrió Compartir para que elijas Guardar.'), 'La interfaz debe explicar claramente el fallback de versiones antiguas.')
assert(androidBuild.includes('versionCode 122') && androidBuild.includes('versionName "1.4.102"'), 'La próxima APK debe superar el versionCode 121 realmente publicado.')
assert(updatePreparation.includes('LAST_DISTRIBUTED_VERSION_CODE = 121'), 'La preparación de OTA debe rechazar versiones iguales o inferiores a la versión Production 121.')
assert(!receipt.includes("window.open('', '_blank')"), 'La venta no debe reemplazar el WebView visible para imprimir.')
assert(printPlugin.includes('new WebView(getContext())'), 'La impresión debe usar un WebView aislado.')
assert(printPlugin.includes('view.destroy()'), 'El WebView temporal debe destruirse al finalizar o cancelar.')

console.log('17 comprobaciones de compatibilidad, compartir e impresión Android aprobadas')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

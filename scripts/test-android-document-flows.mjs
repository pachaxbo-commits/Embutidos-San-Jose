import { readFile } from 'node:fs/promises'

const receipt = await readFile('src/modules/distribution/data/distributionReceiptService.ts', 'utf8')
const collectionPayload = await readFile('src/modules/distribution/domain/collectionReceiptPayload.ts', 'utf8')
const printService = await readFile('src/services/printing/documentPrintService.ts', 'utf8')
const printPlugin = await readFile('android/app/src/main/java/com/pachax/flow/plugins/SanJoseDocumentPrintPlugin.java', 'utf8')
const manifest = await readFile('android/app/src/main/AndroidManifest.xml', 'utf8')

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
assert(!receipt.includes("window.open('', '_blank')"), 'La venta no debe reemplazar el WebView visible para imprimir.')
assert(printPlugin.includes('new WebView(getContext())'), 'La impresión debe usar un WebView aislado.')
assert(printPlugin.includes('view.destroy()'), 'El WebView temporal debe destruirse al finalizar o cancelar.')

console.log('13 comprobaciones de compartir e impresión Android aprobadas')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

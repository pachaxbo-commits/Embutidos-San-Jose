import { Capacitor, registerPlugin } from '@capacitor/core'

interface SanJoseDocumentPrintPlugin {
  printHtml(options: { html: string; jobName: string }): Promise<{ opened: boolean }>
}

const NativeDocumentPrint = registerPlugin<SanJoseDocumentPrintPlugin>('SanJoseDocumentPrint')

async function brandLogoDataUrl(): Promise<string> {
  try {
    const response = await fetch('/brand/san-jose-logo.png')
    if (!response.ok) return ''
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

async function inlinePrintAssets(html: string): Promise<string> {
  const logo = await brandLogoDataUrl()
  return logo ? html.replaceAll('/brand/san-jose-logo.png', logo) : html
}

function printInPopup(html: string): void {
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('El navegador bloqueó la ventana de impresión.')
  popup.document.open()
  popup.document.write(html.replace('</body>', '<script>window.onafterprint=()=>window.close();window.onload=()=>window.print()</script></body>'))
  popup.document.close()
}

/** Imprime sin reemplazar el WebView visible de la aplicación Android. */
export async function printHtmlDocument(html: string, jobName: string): Promise<void> {
  const completeHtml = await inlinePrintAssets(html)
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    await NativeDocumentPrint.printHtml({ html: completeHtml, jobName })
    return
  }
  printInPopup(completeHtml)
}

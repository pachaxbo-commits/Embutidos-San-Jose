import { buildQuoteSharePayload } from '../quoteSharePayload.ts'
import type { DistQuote } from '../../types'

const quote = { id: 'quote-1', quoteNumber: 'COT-44' } as DistQuote
const payload = buildQuoteSharePayload(quote, 'file:///cache/cotizacion.png')
if (payload.title !== 'Cotización COT-44' || payload.dialogTitle !== 'Enviar cotización por WhatsApp u otra aplicación' || payload.files[0] !== 'file:///cache/cotizacion.png') throw new Error('El cuadro nativo de compartir debe recibir el archivo y ofrecer WhatsApp')
console.log('PASS: compartir cotización usa el archivo local y abre selector de aplicaciones Android')

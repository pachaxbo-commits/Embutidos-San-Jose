import type { PrinterProfile } from '../../types/printing'

export type EffectivePrinterLanguage = 'escpos' | 'tspl'

/** Bluetooth no publica el lenguaje; el modelo permite una detección conservadora con ajuste manual. */
export function detectPrinterLanguage(name = ''): EffectivePrinterLanguage {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  return /QIRUI|BEEPRT|LABEL|QR\s*[-_]?\s*(?:368|380)/.test(normalized) ? 'tspl' : 'escpos'
}

export function resolvePrinterLanguage(printer: PrinterProfile): EffectivePrinterLanguage {
  if (printer.commandLanguage === 'tspl') return 'tspl'
  if (printer.commandLanguage === 'escpos') return 'escpos'
  return detectPrinterLanguage(printer.name)
}

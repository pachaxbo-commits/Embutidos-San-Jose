import { PrintEngineService } from '../printEngineService'
import { DiagnosticPrinterAdapter } from '../diagnosticPrinterAdapter'
import { IndexedDbPrintJobStorage } from '../printJobStorage'
import { buildReceiptBytes } from '../templates/receiptTemplate'
import { buildTsplReceiptBytes } from '../templates/tsplReceiptTemplate'
import { detectPrinterLanguage, resolvePrinterLanguage } from '../printerLanguage'
import { transliterateText } from '../escPosFormatter'
import type { PrinterProfile, PrintJobPayload } from '../../../types/printing'

export async function runPrintEngineTestSuite(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = []
  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string) {
    if (condition) {
      passed++
      results.push(`✅ PASS: ${testName}`)
    } else {
      failed++
      results.push(`❌ FAIL: ${testName}`)
    }
  }

  const samplePayload: PrintJobPayload = {
    payloadSchemaVersion: 1,
    templateVersion: 'v1.0',
    restaurantName: 'Embutidos San Jose',
    branchName: 'Almacen Central',
    orderId: 'ord-101',
    sequenceNumber: 15,
    displayNumber: '#015',
    items: [
      { name: 'Chorizo parrillero con ají', basePrice: 35, quantity: 2, lineTotal: 70 },
    ],
    subtotal: 70,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    grandTotal: 70,
    isCopy: false,
    copies: 1,
    createdIso: new Date().toISOString(),
  }

  const samplePrinter: PrinterProfile = {
    id: 'prn-main',
    restaurantId: 'sanjose',
    branchId: 'main',
    name: 'Impresora principal',
    role: 'receipt',
    connectionType: 'virtual_pdf',
    paperWidth: '80mm',
    copies: 1,
    autoPrintOnOrderCreated: true,
    autoPrintOnOrderPaid: true,
    kickDrawerOnPrint: true,
    isActive: true,
    createdAt: new Date().toISOString(),
    capabilities: {
      supportsCashDrawerKick: true,
      supportsPaperCut: true,
      supportsBeep: true,
      supportsBarcode: true,
      supportsQrCode: true,
      supportsImages: true,
      supportsRealtimeStatus: false,
      columnsPerLine: 48,
      codePage: 'CP850',
      encoding: 'utf-8',
      chunkSize: 1024,
      chunkDelayMs: 50,
      connectionTimeoutMs: 5000,
      writeTimeoutMs: 5000,
      feedLinesEnd: 3,
    },
  }

  const backupPrinter: PrinterProfile = {
    ...samplePrinter,
    id: 'prn-backup',
    name: 'Impresora de respaldo',
    role: 'receipt',
    paperWidth: '58mm',
  }

  // --- Test 1: Idempotency deduplication ---
  try {
    const engine = PrintEngineService.getInstance(new IndexedDbPrintJobStorage())
    engine.registerPrinterProfile(samplePrinter)

    const key = `test-idempotency-${Date.now()}`
    const job1 = await engine.submitPrintRequest({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key })
    const job2 = await engine.submitPrintRequest({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key })

    assert(job1.id === job2.id && (job1.status === 'transmitted' || job1.status === 'queued'), 'Prueba 1: Dos solicitudes con la misma clave no crean dos trabajos')
  } catch (e: any) {
    assert(false, `Prueba 1 Fallo: ${e.message}`)
  }

  // --- Test 2: Safe retry on pre-transmit error ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const mockAdapter = new DiagnosticPrinterAdapter('error_pre_transmit')
    engine.registerAdapter(mockAdapter)

    const job = await engine.submitPrintRequest({ targetType: 'receipt', payload: samplePayload, idempotencyKey: `safe-retry-${Date.now()}` })
    assert(job.status === 'queued' || job.status === 'retrying' || job.printerProfileId === 'prn-backup', 'Prueba 2: Un fallo antes de transmitir permite reintento o failover')
  } catch (e: any) {
    assert(false, `Prueba 2 Fallo: ${e.message}`)
  }

  // --- Test 3: Intra-transmit error transitions to unknown ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const mockAdapter = new DiagnosticPrinterAdapter('error_during_transmit')
    engine.registerAdapter(mockAdapter)

    const job = await engine.submitPrintRequest({ targetType: 'receipt', payload: samplePayload, idempotencyKey: `unsafe-retry-${Date.now()}` })
    assert(job.status === 'unknown', 'Prueba 3: Un fallo durante la transmision termina en estado UNKNOWN')
  } catch (e: any) {
    assert(false, `Prueba 3 Fallo: ${e.message}`)
  }

  // --- Test 4: Unknown job is never auto-reprinted ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `unknown-auto-${Date.now()}`
    const job = await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    await storage.update(job.id, { status: 'unknown' })
    const acquired = await engine.queueManager.acquireLease(job.id)
    assert(!acquired, 'Prueba 4: Un trabajo en UNKNOWN no se reimprime automaticamente (lease denegado)')
  } catch (e: any) {
    assert(false, `Prueba 4 Fallo: ${e.message}`)
  }

  // --- Test 5: Failover only occurs on safeToRetry errors ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    engine.registerPrinterProfile(samplePrinter)
    engine.registerPrinterProfile(backupPrinter)

    const key = `failover-safe-${Date.now()}`
    const job = await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter, backupPrinter)

    // Simulate pre-transmit error
    const adapter = new DiagnosticPrinterAdapter('error_pre_transmit')
    const resultJob = await engine.queueManager.processJob(job.id, adapter, samplePrinter, backupPrinter)
    assert(resultJob.printerProfileId === backupPrinter.id, 'Prueba 5: El failover solo ocurre con errores safeToRetry')
  } catch (e: any) {
    assert(false, `Prueba 5 Fallo: ${e.message}`)
  }

  // --- Test 6: Lease prevents another instance from processing the same job ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine1 = PrintEngineService.getInstance(storage)
    const key = `lease-lock-${Date.now()}`
    const job = await engine1.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    await engine1.queueManager.acquireLease(job.id)
    // Create second queue manager instance simulating another tab
    const engine2Manager = new (engine1.queueManager.constructor as any)(storage, 'term-other')
    const acquiredByOther = await engine2Manager.acquireLease(job.id)

    assert(!acquiredByOther, 'Prueba 6: El lease impide que dos instancias procesen el mismo trabajo')
  } catch (e: any) {
    assert(false, `Prueba 6 Fallo: ${e.message}`)
  }

  // --- Test 7: Lease is renewed while job is active ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `lease-renew-${Date.now()}`
    const job = await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    await engine.queueManager.acquireLease(job.id)
    const initialLease = (await storage.get(job.id))?.leaseExpiresAtIso

    await new Promise((r) => setTimeout(r, 50))
    await engine.queueManager.renewLease(job.id)
    const renewedLease = (await storage.get(job.id))?.leaseExpiresAtIso

    assert(Boolean(initialLease && renewedLease && renewedLease >= initialLease), 'Prueba 7: El lease se renueva mientras el trabajo esta activo')
  } catch (e: any) {
    assert(false, `Prueba 7 Fallo: ${e.message}`)
  }

  // --- Test 8: Queue recovers pending jobs after restart ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `recovery-${Date.now()}`
    await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    const recoverable = await engine.bootstrap()
    assert(recoverable.length > 0, 'Prueba 8: La cola se recupera despues de reiniciar el servicio')
  } catch (e: any) {
    assert(false, `Prueba 8 Fallo: ${e.message}`)
  }

  // --- Test 9: Authorized reprint creates copy job ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `orig-reprint-${Date.now()}`
    const original = await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    const copyJob = await engine.requestReprint(
      { originalJobId: original.id, requestedByUid: 'user-caja-01', reason: 'Papel atascado', terminalId: engine.queueManager.terminalId },
      original
    )

    assert(copyJob.payload.isCopy === true && copyJob.payload.reprintReason === 'Papel atascado', 'Prueba 9: La reimpresion crea un nuevo trabajo marcado como COPIA con motivo')
  } catch (e: any) {
    assert(false, `Prueba 9 Fallo: ${e.message}`)
  }

  // --- Test 10: Payload immutability ---
  try {
    const mutablePayload: PrintJobPayload = { ...samplePayload, items: [{ ...samplePayload.items[0] }] }
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)

    const job = await engine.queueManager.submitJob({ targetType: 'receipt', payload: mutablePayload, idempotencyKey: `mut-${Date.now()}` }, samplePrinter)
    mutablePayload.items[0].name = 'PRODUCTO MUTADO DESPUES DE ENCOLAR'

    const saved = await storage.get(job.id)
    assert(saved?.payload.items[0].name !== 'PRODUCTO MUTADO DESPUES DE ENCOLAR', 'Prueba 10: El payload no cambia aunque se modifique el objeto original')
  } catch (e: any) {
    assert(false, `Prueba 10 Fallo: ${e.message}`)
  }

  // --- Test 11: Backup printer is NOT used after transmission starts ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `no-backup-mid-${Date.now()}`
    const job = await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter, backupPrinter)

    const adapter = new DiagnosticPrinterAdapter('error_during_transmit')
    const resultJob = await engine.queueManager.processJob(job.id, adapter, samplePrinter, backupPrinter)

    assert(resultJob.status === 'unknown' && resultJob.printerProfileId === samplePrinter.id, 'Prueba 11: La impresora de respaldo NO se utiliza despues de comenzar la transmision')
  } catch (e: any) {
    assert(false, `Prueba 11 Fallo: ${e.message}`)
  }

  // --- Test 12: Cleanup purges raw bytes while retaining payload ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `purge-bytes-${Date.now()}`
    const job = await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    const adapter = new DiagnosticPrinterAdapter('success_transmitted')
    const resultJob = await engine.queueManager.processJob(job.id, adapter, samplePrinter)

    assert(resultJob.status === 'transmitted' && resultJob.rawBytesBase64 === undefined && resultJob.payload !== undefined, 'Prueba 12: La limpieza elimina bytes crudos pero conserva el payload sanitizado')
  } catch (e: any) {
    assert(false, `Prueba 12 Fallo: ${e.message}`)
  }

  // --- Test 13: Terminal ownership filtering ---
  try {
    const storage = new IndexedDbPrintJobStorage()
    const engine = PrintEngineService.getInstance(storage)
    const key = `term-filter-${Date.now()}`
    await engine.queueManager.submitJob({ targetType: 'receipt', payload: samplePayload, idempotencyKey: key }, samplePrinter)

    const otherRecoverable = await storage.listRecoverable('other-terminal-99')
    assert(otherRecoverable.length === 0, 'Prueba 13: Los trabajos de una terminal no son recuperados por otra terminal')
  } catch (e: any) {
    assert(false, `Prueba 13 Fallo: ${e.message}`)
  }

  // --- Test 14: 58mm and 80mm templates formatting ---
  try {
    const bytes58 = buildReceiptBytes(samplePayload, '58mm')
    const bytes80 = buildReceiptBytes(samplePayload, '80mm')
    assert(bytes58.length > 0 && bytes80.length > 0, 'Prueba 14: Las plantillas se formatean correctamente para 58mm y 80mm')
  } catch (e: any) {
    assert(false, `Prueba 14 Fallo: ${e.message}`)
  }

  // --- Test 15: Special character transliteration fallback ---
  try {
    const rawText = 'Hamburguesa con Queso, Ñandú y Ají'
    const clean = transliterateText(rawText)

    assert(clean.includes('Nandu') && clean.includes('Aji') && !clean.includes('ñ') && !clean.includes('í'), 'Prueba 15: Los caracteres especiales (tildes, n) tienen un transliterador controlado para ESC/POS')
  } catch (e: any) {
    assert(false, `Prueba 15 Fallo: ${e.message}`)
  }

  // --- Test 16: Perfil de la impresora real de 80 mm ---
  try {
    const bytes = Array.from(buildReceiptBytes(samplePayload, '80mm', true))
    const contains = (sequence: number[]) => bytes.some((_, index) => sequence.every((byte, offset) => bytes[index + offset] === byte))

    assert(
      contains([0x1b, 0x74, 0x02]) && contains([0x1d, 0x56, 0x42, 0x00]),
      'Prueba 16: El ticket usa CP850 y el corte parcial probado con la impresora de BURGUERLAB',
    )
  } catch (e: any) {
    assert(false, `Prueba 16 Fallo: ${e.message}`)
  }

  // --- Test 17: Logo monocromo oficial de San José ---
  try {
    const sanJosePayload = { ...samplePayload, restaurantName: 'Embutidos San José' }
    const bytes = Array.from(buildReceiptBytes(sanJosePayload, '80mm', true))
    const hasRasterLogo = bytes.some((_, index) =>
      [0x1d, 0x76, 0x30, 0x00].every((byte, offset) => bytes[index + offset] === byte),
    )
    assert(hasRasterLogo, 'Prueba 17: El ticket de San José incluye el logo monocromo ESC/POS')
  } catch (e: any) {
    assert(false, `Prueba 17 Fallo: ${e.message}`)
  }

  // --- Test 18: selección automática y plantilla de etiquetas QR-368BT ---
  try {
    const labelPrinter: PrinterProfile = { ...samplePrinter, name: 'QR380A-FE0A43', connectionType: 'bluetooth_spp', commandLanguage: 'auto', capabilities: { ...samplePrinter.capabilities, supportsPaperCut: false } }
    const tspl = new TextDecoder().decode(buildTsplReceiptBytes(samplePayload, '80mm'))
    assert(
      detectPrinterLanguage('QIRUI QR-368BT') === 'tspl'
        && resolvePrinterLanguage(labelPrinter) === 'tspl'
        && detectPrinterLanguage('POS-80') === 'escpos'
        && tspl.startsWith('SIZE 80 mm,')
        && tspl.includes('\r\nCLS\r\n')
        && tspl.includes('BITMAP ')
        && tspl.endsWith('PRINT 1,1\r\n'),
      'Prueba 18: Automático reconoce QR-368BT y genera un comprobante TSPL con logo y sin comandos de corte',
    )
  } catch (e: any) {
    assert(false, `Prueba 18 Fallo: ${e.message}`)
  }

  return { passed, failed, results }
}

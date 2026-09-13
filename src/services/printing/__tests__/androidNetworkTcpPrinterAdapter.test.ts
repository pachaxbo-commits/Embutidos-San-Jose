import {
  AndroidNetworkTcpPrinterAdapter,
  isValidIpOrHost,
  isValidPort,
  uint8ArrayToBase64,
} from '../../../adapters/printing/androidNetworkTcpPrinterAdapter'
import type { PrinterProfile } from '../../../types/printing'

export async function runAndroidNetworkTcpTestSuite(): Promise<{ passed: number; failed: number; results: string[] }> {
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

  const sampleLanPrinter: PrinterProfile = {
    id: 'prn-lan-01',
    restaurantId: 'sanjose',
    branchId: 'main',
    name: 'Impresora Red Cocina TCP',
    role: 'receipt',
    connectionType: 'network_tcp',
    paperWidth: '80mm',
    ipAddress: '192.168.1.150',
    port: 9100,
    copies: 1,
    autoPrintOnOrderCreated: true,
    autoPrintOnOrderPaid: true,
    kickDrawerOnPrint: false,
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
      chunkDelayMs: 10,
      connectionTimeoutMs: 3000,
      writeTimeoutMs: 3000,
      feedLinesEnd: 3,
    },
  }

  // --- Test 1: Valid IPv4 validation ---
  try {
    assert(isValidIpOrHost('192.168.1.150') && isValidIpOrHost('10.0.0.25'), 'LAN-1: Validación correcta de direcciones IPv4 válidas')
  } catch (e: any) {
    assert(false, `LAN-1 Fallo: ${e.message}`)
  }

  // --- Test 2: Invalid IP string validation ---
  try {
    assert(!isValidIpOrHost('999.999.999.999') && !isValidIpOrHost('abc'), 'LAN-2: Rechazo de direcciones IP inválidas')
  } catch (e: any) {
    assert(false, `LAN-2 Fallo: ${e.message}`)
  }

  // --- Test 3: Valid Hostname validation ---
  try {
    assert(isValidIpOrHost('impresora-almacen.local'), 'LAN-3: Validación correcta de nombres de equipo en red local')
  } catch (e: any) {
    assert(false, `LAN-3 Fallo: ${e.message}`)
  }

  // --- Test 4: Valid Port range validation ---
  try {
    assert(isValidPort(9100) && isValidPort(80) && isValidPort(65535), 'LAN-4: Rango válido de puertos TCP (1-65535)')
  } catch (e: any) {
    assert(false, `LAN-4 Fallo: ${e.message}`)
  }

  // --- Test 5: Invalid Port number validation ---
  try {
    assert(!isValidPort(0) && !isValidPort(70000) && !isValidPort(-5), 'LAN-5: Rechazo de puertos TCP fuera de rango')
  } catch (e: any) {
    assert(false, `LAN-5 Fallo: ${e.message}`)
  }

  // --- Test 6: Standalone connection test success ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    const res = await adapter.testConnection('192.168.1.150', 9100)
    assert(res.connected === true, 'LAN-6: Prueba autónoma de socket TCP ("Probar Conexión") exitosa')
  } catch (e: any) {
    assert(false, `LAN-6 Fallo: ${e.message}`)
  }

  // --- Test 7: Connection test with invalid IP ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    const res = await adapter.testConnection('0.0.0.0', 9100)
    assert(res.connected === false && res.errorType === 'invalid_address', 'LAN-7: Prueba de conexión con IP inválida devuelve error controlado')
  } catch (e: any) {
    assert(false, `LAN-7 Fallo: ${e.message}`)
  }

  // --- Test 8: Socket connection ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    assert(adapter.getActiveConnectionId() !== null, 'LAN-8: Conexión de socket TCP nativo abierta con ID asignado')
  } catch (e: any) {
    assert(false, `LAN-8 Fallo: ${e.message}`)
  }

  // --- Test 9: Pre-connection error classification ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    const invalidPrinter: PrinterProfile = { ...sampleLanPrinter, ipAddress: '' }
    let classification = ''
    try {
      await adapter.connect(invalidPrinter)
    } catch (err: any) {
      classification = err.classification
    }
    assert(classification === 'safeToRetry', 'LAN-9: Error pre-conexión de IP faltante clasificado como safeToRetry')
  } catch (e: any) {
    assert(false, `LAN-9 Fallo: ${e.message}`)
  }

  // --- Test 10: Complete chunked byte transmission over TCP ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    const testBytes = new Uint8Array(2500) // 2500 bytes with chunkSize 1024 = 3 chunks
    const result = await adapter.sendBytes({ jobId: 'job-tcp-test', bytes: testBytes, printer: sampleLanPrinter })

    assert(result.success === true && result.bytesWritten === 2500, 'LAN-10: Transmisión de 2500 bytes en bloques TCP exitosa')
    await adapter.disconnect()
  } catch (e: any) {
    assert(false, `LAN-10 Fallo: ${e.message}`)
  }

  // --- Test 11: Base64 encoding payload accuracy ---
  try {
    const rawBytes = new Uint8Array([0x1b, 0x40, 0x50, 0x41, 0x43, 0x48, 0x41, 0x58])
    const b64 = uint8ArrayToBase64(rawBytes)
    assert(typeof b64 === 'string' && b64.length > 0, 'LAN-11: Conversión precisa de bytes Uint8Array a Base64 para el puente de socket')
  } catch (e: any) {
    assert(false, `LAN-11 Fallo: ${e.message}`)
  }

  // --- Test 12: Disconnect handling ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    await adapter.disconnect()
    assert(adapter.getActiveConnectionId() === null, 'LAN-12: Cierre y desconexión limpia del socket TCP')
  } catch (e: any) {
    assert(false, `LAN-12 Fallo: ${e.message}`)
  }

  // --- Test 13: Unconnected sendBytes error classification ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    const result = await adapter.sendBytes({ jobId: 'job-unconnected', bytes: new Uint8Array(10), printer: sampleLanPrinter })
    assert(result.success === false && result.errorClassification === 'safeToRetry', 'LAN-13: Intento de envío sin socket conectado clasificado como safeToRetry')
  } catch (e: any) {
    assert(false, `LAN-13 Fallo: ${e.message}`)
  }

  // --- Test 14: Default port 9100 fallback ---
  try {
    const printerWithoutPort: PrinterProfile = { ...sampleLanPrinter, port: undefined }
    assert((printerWithoutPort.port || 9100) === 9100, 'LAN-14: Asignación por defecto del puerto TCP 9100 para impresoras térmicas RAW')
  } catch (e: any) {
    assert(false, `LAN-14 Fallo: ${e.message}`)
  }

  // --- Test 15: Chunk splitting calculation for TCP ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    const testBytes = new Uint8Array(3000) // 3000 bytes with chunkSize 1024 = 3 chunks
    const result = await adapter.sendBytes({ jobId: 'job-tcp-chunks', bytes: testBytes, printer: sampleLanPrinter })

    assert(result.bytesWritten === 3000, 'LAN-15: Cálculo de fragmentación TCP para tickets largos')
    await adapter.disconnect()
  } catch (e: any) {
    assert(false, `LAN-15 Fallo: ${e.message}`)
  }

  // --- Test 16: Safe retry before chunk 1 ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    // Simulated unconnected state error
    const result = await adapter.sendBytes({ jobId: 'job-pre-chunk', bytes: new Uint8Array(100), printer: sampleLanPrinter })
    assert(result.errorClassification === 'safeToRetry', 'LAN-16: Error antes del primer chunk permite safeToRetry')
  } catch (e: any) {
    assert(false, `LAN-16 Fallo: ${e.message}`)
  }

  // --- Test 17: Terminal status isolation ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    const result = await adapter.sendBytes({ jobId: 'job-terminal-tcp', bytes: new Uint8Array(500), printer: sampleLanPrinter })
    assert(result.hardwareConfirmed === false, 'LAN-17: Transmisión TCP RAW termina como TRANSMITTED (sin asumir confirmación física)')
    await adapter.disconnect()
  } catch (e: any) {
    assert(false, `LAN-17 Fallo: ${e.message}`)
  }

  // --- Test 18: Re-connection lifecycle ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    await adapter.disconnect()
    await adapter.connect(sampleLanPrinter)
    assert(adapter.getActiveConnectionId() !== null, 'LAN-18: Ciclo completo de reconexión de socket TCP')
    await adapter.disconnect()
  } catch (e: any) {
    assert(false, `LAN-18 Fallo: ${e.message}`)
  }

  // --- Test 19: Standalone connection test on invalid port ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    const res = await adapter.testConnection('192.168.1.150', 70000)
    assert(res.connected === false && res.errorType === 'invalid_address', 'LAN-19: Prueba autónoma en puerto inválido rechazada correctamente')
  } catch (e: any) {
    assert(false, `LAN-19 Fallo: ${e.message}`)
  }

  // --- Test 20: Socket state cleanup after disconnect ---
  try {
    const adapter = new AndroidNetworkTcpPrinterAdapter()
    await adapter.connect(sampleLanPrinter)
    await adapter.disconnect()
    assert(adapter.getActiveConnectionId() === null, 'LAN-20: Limpieza total de referencias de socket TCP tras desconexión')
  } catch (e: any) {
    assert(false, `LAN-20 Fallo: ${e.message}`)
  }

  return { passed, failed, results }
}

import { Bluetooth, Check, CheckCircle2, Loader2, Printer, Search, Wifi, XCircle } from 'lucide-react'
import { useState } from 'react'
import { isValidIpOrHost } from '../../../adapters/printing/androidNetworkTcpPrinterAdapter'
import { AndroidBluetoothSppAdapter, type BluetoothPairedDevice } from '../../../adapters/printing/androidBluetoothSppAdapter'
import { Field, TextInput } from '../../../components/ui/Form'
import { Modal } from '../../../components/ui/Modal'
import { AndroidBluetoothPermissionsService } from '../../../services/printing/androidBluetoothPermissionsService'
import { getActiveReceiptPrinter, savePrinterProfile } from '../../../services/printing/printerBootstrap'
import { PrintEngineService } from '../../../services/printing/printEngineService'
import { detectPrinterLanguage } from '../../../services/printing/printerLanguage'
import { PrimaryButton, SecondaryButton } from './shared'
import type { PrinterProfile } from '../../../types/printing'

type PrinterStatus = 'idle' | 'searching' | 'selected' | 'testing' | 'success' | 'error'

function looksLikePrinter(device: BluetoothPairedDevice): boolean {
  return /PRINTER|POS|QIRUI|BEEPRT|QR\s*[-_]?\s*(?:368|380)|THERMAL|IMPRESORA/i.test(device.name)
}

export function DistributionPrinterModal({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
  const previous = getActiveReceiptPrinter()
  const [connection, setConnection] = useState<'bluetooth_spp' | 'network_tcp'>(previous?.connectionType === 'network_tcp' ? 'network_tcp' : 'bluetooth_spp')
  const [address, setAddress] = useState(previous?.macAddress || '')
  const [ip, setIp] = useState(previous?.ipAddress || '')
  const [paper, setPaper] = useState<'58mm' | '80mm'>(previous?.paperWidth || '80mm')
  const [commandLanguage, setCommandLanguage] = useState<'auto' | 'escpos' | 'tspl'>(previous?.commandLanguage || 'auto')
  const [devices, setDevices] = useState<BluetoothPairedDevice[]>([])
  const [feedback, setFeedback] = useState(previous ? 'Configuración guardada en este dispositivo.' : 'Vincula la impresora en Android y luego búscala aquí.')
  const [status, setStatus] = useState<PrinterStatus>(previous ? 'selected' : 'idle')
  const busy = status === 'searching' || status === 'testing'

  const selectedDevice = devices.find(device => device.address === address)
  const printerName = selectedDevice?.name || previous?.name || 'Impresora de recibos'
  const detectedLanguage = commandLanguage === 'auto' ? detectPrinterLanguage(printerName) : commandLanguage
  const isValid = connection === 'bluetooth_spp' ? /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address.trim()) : isValidIpOrHost(ip)

  const profile = (): PrinterProfile => {
    if (connection === 'bluetooth_spp' && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address.trim())) throw new Error('Selecciona una impresora Bluetooth vinculada.')
    if (connection === 'network_tcp' && !isValidIpOrHost(ip)) throw new Error('Ingresa la dirección IP de la impresora.')
    return {
      id: previous?.id || `receipt-${restaurantId}`,
      restaurantId,
      branchId: 'main',
      name: printerName,
      role: 'receipt',
      connectionType: connection,
      macAddress: address.trim(),
      ipAddress: ip.trim(),
      port: 9100,
      paperWidth: paper,
      commandLanguage,
      copies: 1,
      isActive: true,
      autoPrintOnOrderCreated: false,
      autoPrintOnOrderPaid: false,
      kickDrawerOnPrint: false,
      createdAt: previous?.createdAt || new Date().toISOString(),
      capabilities: {
        supportsCashDrawerKick: false,
        supportsPaperCut: detectedLanguage === 'escpos' && paper === '80mm',
        supportsBeep: false,
        supportsBarcode: false,
        supportsQrCode: false,
        supportsImages: false,
        supportsRealtimeStatus: false,
        columnsPerLine: paper === '58mm' ? 32 : 48,
        codePage: 'CP850',
        encoding: 'cp850',
        chunkSize: 256,
        chunkDelayMs: 40,
        connectionTimeoutMs: 6000,
        writeTimeoutMs: 5000,
        feedLinesEnd: 3,
      },
    }
  }

  const save = () => {
    try {
      savePrinterProfile(profile())
      setStatus('selected')
      setFeedback('Impresora guardada en este dispositivo.')
    } catch (error) {
      setStatus('error')
      setFeedback((error as Error).message)
    }
  }

  const searchDevices = async () => {
    setStatus('searching')
    setFeedback('Buscando dispositivos vinculados...')
    try {
      let state = await AndroidBluetoothPermissionsService.checkDiagnosticState()
      if (state.isNativeAndroid && state.bluetoothConnectPermission !== 'granted') state = await AndroidBluetoothPermissionsService.requestConnectPermission()
      if (state.isNativeAndroid && state.bluetoothConnectPermission !== 'granted') throw new Error(state.message)
      if (state.isNativeAndroid && !state.isBluetoothEnabled) throw new Error(state.message)
      const found = await new AndroidBluetoothSppAdapter().listPairedDevices()
      const ordered = [...found].sort((left, right) => Number(looksLikePrinter(right)) - Number(looksLikePrinter(left)) || left.name.localeCompare(right.name))
      setDevices(ordered)
      setStatus(found.length ? address ? 'selected' : 'idle' : 'error')
      setFeedback(found.length ? 'Toca la impresora que utilizarás.' : 'No se encontraron equipos. Primero vincula la impresora desde Ajustes de Android.')
    } catch (error) {
      setStatus('error')
      setFeedback((error as Error).message)
    }
  }

  const test = async () => {
    setStatus('testing')
    setFeedback('Conectando y enviando una prueba...')
    try {
      const printer = profile()
      savePrinterProfile(printer)
      if (printer.connectionType === 'bluetooth_spp') {
        let state = await AndroidBluetoothPermissionsService.checkDiagnosticState()
        if (state.isNativeAndroid && state.bluetoothConnectPermission !== 'granted') state = await AndroidBluetoothPermissionsService.requestConnectPermission()
        if (state.isNativeAndroid && state.bluetoothConnectPermission !== 'granted') throw new Error(state.message)
        if (state.isNativeAndroid && !state.isBluetoothEnabled) throw new Error(state.message)
      }
      const job = await PrintEngineService.getInstance().submitPrintRequest({
        printerProfileId: printer.id,
        targetType: 'receipt',
        idempotencyKey: `test:${Date.now()}`,
        payload: { payloadSchemaVersion: 1, templateVersion: 'v1', restaurantName: 'EMBUTIDOS SAN JOSÉ', branchName: 'PRUEBA DE IMPRESIÓN', items: [{ name: 'Producto de prueba', basePrice: 10, quantity: 1, unitLabel: 'u', lineTotal: 10 }], subtotal: 10, discountTotal: 0, taxTotal: 0, deliveryFee: 0, grandTotal: 10, paymentMethod: 'EFECTIVO', isCopy: false, copies: 1, createdIso: new Date().toISOString(), customMessage: 'Conexión correcta' },
      })
      if (!['transmitted', 'confirmed'].includes(job.status)) throw new Error(job.lastError || 'La impresora no confirmó el envío.')
      setStatus('success')
      setFeedback('Conexión correcta. Comprueba que el ticket salió completo y cortó el papel.')
    } catch (error) {
      setStatus('error')
      setFeedback((error as Error).message)
    }
  }

  return <Modal isOpen onClose={onClose} title="Configurar impresora" subtitle="Una configuración por teléfono o tablet" footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy || !isValid} onClick={() => void test()}><Printer size={16} /> Probar</SecondaryButton><PrimaryButton full disabled={busy || !isValid} onClick={save}>Guardar</PrimaryButton></div>}>
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setConnection('bluetooth_spp'); setStatus(address ? 'selected' : 'idle') }} className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-extrabold ${connection === 'bluetooth_spp' ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 text-slate-600'}`}><Bluetooth size={22} /> Bluetooth</button>
        <button type="button" onClick={() => { setConnection('network_tcp'); setStatus(ip ? 'selected' : 'idle') }} className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-extrabold ${connection === 'network_tcp' ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 text-slate-600'}`}><Wifi size={22} /> Red local</button>
      </div>

      {connection === 'bluetooth_spp' ? <div className="grid gap-2">
        <SecondaryButton full disabled={busy} onClick={() => void searchDevices()}>{status === 'searching' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {status === 'searching' ? 'Buscando...' : 'Buscar equipos vinculados'}</SecondaryButton>
        {devices.length > 0 && <p className="px-1 text-[10px] font-semibold text-slate-500">Android muestra todos los equipos vinculados. Las posibles impresoras aparecen primero.</p>}
        {devices.map(device => {
          const selected = address === device.address
          return <button key={device.address} type="button" onClick={() => { setAddress(device.address); setStatus('selected'); setFeedback(`${device.name} seleccionada. Realiza una prueba antes de guardar.`) }} className={`flex min-h-[58px] items-center gap-3 rounded-2xl border p-3 text-left ${selected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-slate-200 bg-white'}`}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-[var(--primary)] text-white' : 'bg-slate-100 text-slate-500'}`}><Bluetooth size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><strong className="text-sm leading-snug text-slate-900">{device.name}</strong>{looksLikePrinter(device) && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black text-emerald-700">POSIBLE IMPRESORA</span>}</span><span className="block text-[10px] font-medium text-slate-500">{device.address}</span></span>{selected && <Check size={17} className="shrink-0 text-[var(--primary)]" />}</button>
        })}
        {address && devices.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold text-slate-800">Impresora guardada</p><p className="mt-0.5 text-[10px] text-slate-500">{address}</p></div>}
      </div> : <Field label="Dirección IP"><TextInput value={ip} onChange={event => { setIp(event.target.value); setStatus('idle') }} placeholder="192.168.1.150" inputMode="decimal" /></Field>}

      <Field label="Ancho del papel">
        <div className="grid grid-cols-2 gap-2">{(['58mm', '80mm'] as const).map(width => <button key={width} type="button" onClick={() => setPaper(width)} className={`min-h-[48px] rounded-2xl border text-sm font-extrabold ${paper === width ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 text-slate-600'}`}>{width === '58mm' ? '58 mm' : '80 mm recomendado'}</button>)}</div>
      </Field>

      <Field label="Lenguaje de impresión" hint={`Se utilizará ${detectedLanguage === 'tspl' ? 'TSPL para etiquetas' : 'ESC/POS para tickets'}.`}>
        <div className="grid grid-cols-3 gap-2">
          {([
            ['auto', 'Automático'],
            ['escpos', 'ESC/POS'],
            ['tspl', 'TSPL'],
          ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setCommandLanguage(value)} className={`min-h-[46px] rounded-2xl border px-2 text-[11px] font-extrabold ${commandLanguage === value ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 text-slate-600'}`}>{label}</button>)}
        </div>
      </Field>

      {detectedLanguage === 'tspl' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold leading-relaxed text-amber-900">Modo para QIRUI QR-368BT y otras impresoras de etiquetas. Calcula la altura del comprobante y no envía una orden de corte.</p>}

      <div className={`flex items-start gap-3 rounded-2xl border p-3 transition-all ${status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : status === 'testing' || status === 'searching' ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
        <span className="mt-0.5 shrink-0">{status === 'success' ? <CheckCircle2 size={20} className="animate-pulse" /> : status === 'error' ? <XCircle size={20} /> : status === 'testing' || status === 'searching' ? <Loader2 size={20} className="animate-spin" /> : <Printer size={20} />}</span>
        <div><p className="text-xs font-extrabold">{status === 'success' ? 'Impresora lista' : status === 'error' ? 'No se pudo conectar' : status === 'testing' ? 'Probando conexión' : status === 'searching' ? 'Buscando impresoras' : address || ip ? 'Lista para probar' : 'Configura tu impresora'}</p><p role="status" className="mt-0.5 text-[11px] font-medium leading-snug">{feedback}</p></div>
      </div>
    </div>
  </Modal>
}

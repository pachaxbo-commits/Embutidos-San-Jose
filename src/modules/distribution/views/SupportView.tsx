import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, DatabaseBackup, Printer, Save, ShieldCheck, Wrench } from 'lucide-react'
import { Field, NumberInput, TextArea, TextInput } from '../../../components/ui/Form'
import { Modal } from '../../../components/ui/Modal'
import { Screen } from '../../../components/ui/Screen'
import {
  DEFAULT_SUPPORT_SETTINGS,
  executeCleanDelivery,
  loadSupportSettings,
  prepareCleanDelivery,
  saveSupportSettings,
  type ResetPreview,
  type SupportSettings,
} from '../data/supportMaintenance'
import { PrimaryButton, SecondaryButton, SectionCard } from './shared'

const RESET_PHRASE = 'LIMPIAR EMBUTIDOS SAN JOSE'
const SCOPE_LABELS: Record<string, string> = {
  distCustomers: 'Clientes', distCustomerIdentities: 'Índices de CI', distBalances: 'Existencias actuales',
  distStockMovements: 'Historial de inventario', distTransfers: 'Transferencias', distDispatches: 'Despachos',
  distSales: 'Ventas', distReceivables: 'Créditos', distCollections: 'Cobros', distExpenses: 'Gastos',
  distClosures: 'Cierres y arqueos', distQrVerifications: 'Verificaciones QR', distLots: 'Lotes y vencimientos',
  distLotHistory: 'Historial de lotes', distClaims: 'Cambios y devoluciones', distCreditStatus: 'Estados de crédito',
  distOperations: 'Operaciones técnicas',
}

export function SupportView({ onOpenPrinterSettings, initialSettings }: { onOpenPrinterSettings: () => void; initialSettings?: SupportSettings }) {
  const [settings, setSettings] = useState<SupportSettings>(initialSettings ?? DEFAULT_SUPPORT_SETTINGS)
  const [loading, setLoading] = useState(!initialSettings)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [preview, setPreview] = useState<ResetPreview | null>(null)
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    if (initialSettings) {
      return
    }
    let active = true
    const timeout = window.setTimeout(() => {
      if (!active) return
      setLoading(false)
      setError('La configuración tardó demasiado en responder. Se muestran valores seguros; revisa la conexión antes de guardar.')
    }, 12000)
    void loadSupportSettings()
      .then(value => { if (active) { setSettings(value); setError(null) } })
      .catch(e => { if (active) setError((e as Error).message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; window.clearTimeout(timeout) }
  }, [initialSettings])

  const update = <K extends keyof SupportSettings>(key: K, value: SupportSettings[K]) => setSettings(current => ({ ...current, [key]: value }))

  const save = async () => {
    setBusy(true); setError(null); setFeedback(null)
    try {
      await saveSupportSettings(settings)
      setFeedback('Configuración guardada correctamente.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const inspectReset = async () => {
    setBusy(true); setError(null)
    try { setPreview(await prepareCleanDelivery()) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const executeReset = async () => {
    if (!preview || !acknowledged || phrase !== RESET_PHRASE || !password) return
    setBusy(true); setError(null)
    try {
      const result = await executeCleanDelivery({ requestId: preview.requestId, password, phrase })
      setResetOpen(false); setPreview(null); setPassword(''); setPhrase(''); setAcknowledged(false)
      setFeedback(`Entrega limpia terminada. Se respaldaron y retiraron ${result.deletedDocuments} registros. Respaldo: ${result.backupId}.`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return <Screen title="Configuración" subtitle="Soporte técnico sin acceso a información comercial">
    <div className="grid gap-4 lg:grid-cols-2">
      {loading && <p role="status" className="lg:col-span-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-800">Cargando la configuración guardada…</p>}
      {feedback && <p role="status" className="lg:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800"><CheckCircle2 className="mr-2 inline" size={16} />{feedback}</p>}
      {error && <p role="alert" className="lg:col-span-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}

      <SectionCard title="Empresa y tickets">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre de la empresa"><TextInput value={settings.companyName} onChange={e => update('companyName', e.target.value)} /></Field>
          <Field label="NIT"><TextInput value={settings.taxId} onChange={e => update('taxId', e.target.value)} /></Field>
          <Field label="Teléfono"><TextInput value={settings.phone} onChange={e => update('phone', e.target.value)} /></Field>
          <Field label="Dirección"><TextInput value={settings.address} onChange={e => update('address', e.target.value)} /></Field>
          <Field label="Encabezado del ticket"><TextInput value={settings.receiptHeader} onChange={e => update('receiptHeader', e.target.value)} /></Field>
          <Field label="Pie del ticket"><TextInput value={settings.receiptFooter} onChange={e => update('receiptFooter', e.target.value)} /></Field>
        </div>
      </SectionCard>

      <SectionCard title="Reglas operativas">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Aviso de vencimiento" hint="Días antes del vencimiento."><NumberInput min={1} max={90} value={settings.expiryAlertDays} onChange={e => update('expiryAlertDays', Number(e.target.value))} /></Field>
          <Field label="Bloqueo por crédito" hint="Días de atraso permitidos."><NumberInput min={1} max={90} value={settings.creditBlockDays} onChange={e => update('creditBlockDays', Number(e.target.value))} /></Field>
          <Field label="Papel predeterminado"><div className="grid grid-cols-2 gap-2">{(['58mm','80mm'] as const).map(width => <button type="button" key={width} onClick={() => update('defaultPaperWidth', width)} className={`min-h-[44px] rounded-2xl border text-sm font-extrabold ${settings.defaultPaperWidth === width ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 text-slate-600'}`}>{width}</button>)}</div></Field>
          <label className="flex min-h-[66px] items-center gap-3 rounded-2xl border border-slate-200 p-3"><input type="checkbox" checked={settings.requireQrVerification} onChange={e => update('requireQrVerification', e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" /><span><strong className="block text-sm text-slate-900">Confirmar pagos QR</strong><small className="text-xs text-slate-500">Los QR entran al arqueo después de verificarlos.</small></span></label>
        </div>
        <PrimaryButton full disabled={busy} onClick={() => void save()}><Save size={16} /> {busy ? 'Guardando...' : 'Guardar configuración'}</PrimaryButton>
      </SectionCard>

      <SectionCard title="Impresión de este dispositivo">
        <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3"><Printer size={20} className="mt-0.5 text-[var(--primary)]" /><p className="text-xs font-semibold leading-relaxed text-slate-600">Busca la impresora Bluetooth vinculada, configura el papel y realiza una impresión de prueba.</p></div>
        <SecondaryButton full onClick={onOpenPrinterSettings}><Printer size={16} /> Configurar y probar impresora</SecondaryButton>
      </SectionCard>

      <SectionCard title="Acceso protegido">
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><ShieldCheck size={20} className="mt-0.5 text-emerald-700" /><div><strong className="text-sm text-emerald-900">Información comercial bloqueada</strong><p className="mt-1 text-xs font-medium leading-relaxed text-emerald-800">Este rol no puede consultar ventas, clientes, créditos, cobros, gastos, stock, cierres ni reportes.</p></div></div>
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"><DatabaseBackup size={20} className="mt-0.5 text-amber-700" /><div className="flex-1"><strong className="text-sm text-amber-900">Preparar entrega limpia</strong><p className="mt-1 text-xs font-medium leading-relaxed text-amber-800">Conserva usuarios, productos, rutas, almacenes y configuración. Antes de limpiar crea un respaldo interno restringido.</p><div className="mt-3"><SecondaryButton onClick={() => { setResetOpen(true); setPreview(null); setError(null) }}><Wrench size={16} /> Revisar limpieza</SecondaryButton></div></div></div>
      </SectionCard>
    </div>

    <Modal isOpen={resetOpen} onClose={() => !busy && setResetOpen(false)} title="Preparar entrega limpia" subtitle={preview ? 'Segunda y última confirmación' : 'Primera confirmación: revisar el alcance'} footer={preview ? <PrimaryButton full disabled={busy || !password || !acknowledged || phrase !== RESET_PHRASE} onClick={() => void executeReset()}>{busy ? 'Creando respaldo y limpiando...' : 'Crear respaldo y limpiar datos'}</PrimaryButton> : <PrimaryButton full disabled={busy} onClick={() => void inspectReset()}>{busy ? 'Calculando...' : 'Mostrar datos que se limpiarán'}</PrimaryButton>}>
      {!preview ? <div className="grid gap-3"><div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"><AlertTriangle size={20} className="shrink-0 text-amber-700" /><p className="text-xs font-semibold leading-relaxed text-amber-900">Esta acción se usa una sola vez antes de la entrega. Todavía no eliminará nada: primero mostrará un conteo.</p></div><p className="text-xs font-semibold text-slate-600">Se conservarán usuarios, catálogo de productos, rutas, almacenes, fotografías de productos y configuración.</p></div> : <div className="grid gap-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-extrabold text-slate-900">{preview.totalDocuments} registros serán respaldados y retirados</p><div className="mt-2 grid grid-cols-2 gap-1.5">{Object.entries(preview.counts).filter(([,count]) => count > 0).map(([name,count]) => <span key={name} className="rounded-xl bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{SCOPE_LABELS[name] || name}: {count}</span>)}</div></div>
        <Field label="Contraseña actual" required><TextInput type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <Field label={`Escribe: ${RESET_PHRASE}`} required><TextArea value={phrase} onChange={e => setPhrase(e.target.value.toUpperCase())} /></Field>
        <label className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-0.5 h-5 w-5 accent-rose-600" /><span className="text-xs font-bold leading-relaxed text-rose-900">Confirmo que revisé el conteo y que deseo preparar una base operativa limpia.</span></label>
      </div>}
    </Modal>
  </Screen>
}

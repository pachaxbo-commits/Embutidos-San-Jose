import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App } from '@capacitor/app'
import { AlertTriangle, CheckCircle2, Download, RefreshCw, ShieldCheck } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { SanJoseUpdaterNative, type InstalledAndroidVersion } from './nativePlugin'
import { checkAndroidUpdate } from './updateService'
import { formatUpdateSize, type AndroidUpdateManifest } from './updateManifest'

type UpdateStage = 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'permission' | 'installing' | 'current' | 'error'

interface AndroidUpdaterProps {
  manualCheckRequest: number
  pendingOperations: boolean
}

export default function AndroidUpdater({ manualCheckRequest, pendingOperations }: AndroidUpdaterProps) {
  const [stage, setStage] = useState<UpdateStage>('idle')
  const [installed, setInstalled] = useState<InstalledAndroidVersion | null>(null)
  const [manifest, setManifest] = useState<AndroidUpdateManifest | null>(null)
  const [downloadedFile, setDownloadedFile] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const firstManualRequest = useRef(manualCheckRequest)

  const mandatory = Boolean(manifest && (
    manifest.mandatory ||
    (manifest.minimumSupportedVersionCode !== undefined && installed && installed.versionCode < manifest.minimumSupportedVersionCode)
  ))
  const canPostpone = !mandatory || pendingOperations

  const runCheck = useCallback(async (manual: boolean) => {
    if (manual) setOpen(true)
    setStage('checking')
    setError('')
    try {
      const result = await checkAndroidUpdate(manual)
      setInstalled(result.installed)
      if (result.skippedByCache) {
        setStage('idle')
        return
      }
      setManifest(result.manifest)
      if (result.updateAvailable && result.manifest) {
        setOpen(true)
        setStage('available')
      } else if (manual) {
        setStage('current')
      } else {
        setStage('idle')
        setOpen(false)
      }
    } catch (caught) {
      setError((caught as Error).message || 'No se pudo consultar la actualización.')
      if (manual) {
        setOpen(true)
        setStage('error')
      } else {
        setStage('idle')
        setOpen(false)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void runCheck(false) }, 0)
    return () => window.clearTimeout(timer)
  }, [runCheck])

  useEffect(() => {
    if (manualCheckRequest === firstManualRequest.current) return
    firstManualRequest.current = manualCheckRequest
    const timer = window.setTimeout(() => { void runCheck(true) }, 0)
    return () => window.clearTimeout(timer)
  }, [manualCheckRequest, runCheck])

  const openInstaller = useCallback(async (filePath: string) => {
    const permission = await SanJoseUpdaterNative.checkInstallPermission()
    if (!permission.granted) {
      setStage('permission')
      return
    }
    setStage('installing')
    await SanJoseUpdaterNative.installApk({ filePath })
  }, [])

  useEffect(() => {
    if (stage !== 'permission' || !downloadedFile) return
    let listener: Awaited<ReturnType<typeof App.addListener>> | undefined
    let disposed = false
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      void SanJoseUpdaterNative.checkInstallPermission().then(permission => {
        if (permission.granted) void openInstaller(downloadedFile)
      })
    }).then(handle => {
      if (disposed) void handle.remove()
      else listener = handle
    })
    return () => {
      disposed = true
      void listener?.remove()
    }
  }, [downloadedFile, openInstaller, stage])

  const beginUpdate = async () => {
    if (!manifest) return
    setError('')
    setStage('downloading')
    setProgress(0)
    let listener: Awaited<ReturnType<typeof SanJoseUpdaterNative.addListener>> | undefined
    try {
      listener = await SanJoseUpdaterNative.addListener('downloadProgress', event => setProgress(event.percent))
      const download = await SanJoseUpdaterNative.downloadUpdate({
        url: manifest.apkUrl,
        expectedSizeBytes: manifest.sizeBytes,
      })
      setDownloadedFile(download.filePath)
      setStage('verifying')
      await SanJoseUpdaterNative.verifyApk({
        filePath: download.filePath,
        expectedSha256: manifest.sha256,
        expectedVersionCode: manifest.versionCode,
      })
      await openInstaller(download.filePath)
    } catch (caught) {
      setError((caught as Error).message || 'No se pudo preparar la actualización.')
      setStage('error')
    } finally {
      await listener?.remove()
    }
  }

  const close = () => {
    if (stage === 'downloading' || stage === 'verifying' || stage === 'installing') return
    if (!canPostpone && (stage === 'available' || stage === 'permission')) return
    setOpen(false)
  }

  if (!open) return null

  const footer = (() => {
    if (stage === 'available') {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {canPostpone && <button type="button" onClick={close} className="min-h-[46px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700">{pendingOperations ? 'Terminar sincronización primero' : 'Más tarde'}</button>}
          <button type="button" disabled={pendingOperations} onClick={() => void beginUpdate()} className="min-h-[46px] rounded-2xl bg-[var(--primary)] px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">Actualizar ahora</button>
        </div>
      )
    }
    if (stage === 'permission') {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {canPostpone && <button type="button" onClick={close} className="min-h-[46px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold">Más tarde</button>}
          <button type="button" onClick={() => void SanJoseUpdaterNative.requestInstallPermission()} className={`min-h-[46px] rounded-2xl bg-[var(--primary)] px-4 text-sm font-extrabold text-white ${canPostpone ? '' : 'sm:col-span-2'}`}>Autorizar en Android</button>
          <button type="button" onClick={() => void openInstaller(downloadedFile).catch(caught => { setError((caught as Error).message); setStage('error') })} className="min-h-[46px] rounded-2xl border border-[var(--primary)] px-4 text-sm font-extrabold text-[var(--primary)] sm:col-span-2">Ya autoricé, continuar</button>
        </div>
      )
    }
    if (stage === 'downloading') {
      return <button type="button" onClick={() => void SanJoseUpdaterNative.cancelDownload()} className="min-h-[46px] w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-extrabold text-rose-700">Cancelar descarga</button>
    }
    if (stage === 'current' || stage === 'error') {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={close} className="min-h-[46px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold">Cerrar</button>
          {stage === 'error' && <button type="button" onClick={() => void runCheck(true)} className="min-h-[46px] rounded-2xl bg-[var(--primary)] px-4 text-sm font-extrabold text-white">Intentar otra vez</button>}
        </div>
      )
    }
    return undefined
  })()

  return (
    <Modal isOpen onClose={close} title="Acerca de y actualizaciones" subtitle={installed ? `Versión instalada: ${installed.versionName} (${installed.versionCode})` : undefined} footer={footer}>
      {stage === 'checking' && <Status icon={<RefreshCw className="animate-spin" size={28} />} title="Buscando actualizaciones…" text="La aplicación está comprobando el canal oficial de Embutidos San José." />}
      {stage === 'available' && manifest && (
        <div className="space-y-4">
          <Status icon={<Download size={28} />} title={`Nueva versión ${manifest.versionName}`} text={`${formatUpdateSize(manifest.sizeBytes)} · publicada el ${new Date(manifest.publishedAt).toLocaleDateString('es-BO')}`} />
          {mandatory && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">Esta actualización es necesaria para seguir usando una versión compatible.</div>}
          {pendingOperations && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>No actualices todavía.</strong> Hay operaciones pendientes de confirmación. Espera a que se sincronicen para no interrumpir el trabajo guardado.</div>}
          {manifest.releaseNotes.length > 0 && <div><h3 className="text-sm font-extrabold text-slate-900">Novedades</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{manifest.releaseNotes.map(note => <li key={note}>{note}</li>)}</ul></div>}
        </div>
      )}
      {stage === 'downloading' && <div className="space-y-4"><Status icon={<Download size={28} />} title="Descargando actualización" text="No cierres la aplicación durante la descarga." /><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${progress}%` }} /></div><p className="text-center text-sm font-extrabold text-slate-700">{progress}%</p></div>}
      {stage === 'verifying' && <Status icon={<ShieldCheck size={28} />} title="Verificando seguridad…" text="Comprobando versión, tamaño, SHA-256, paquete y certificado antes de instalar." />}
      {stage === 'permission' && <Status icon={<ShieldCheck size={28} />} title="Falta una autorización de Android" text="Activa “Permitir desde esta fuente” para Embutidos San José. Android mostrará luego su pantalla oficial de instalación." />}
      {stage === 'installing' && <Status icon={<RefreshCw className="animate-spin" size={28} />} title="Abriendo el instalador…" text="Confirma la actualización en la pantalla oficial de Android. Tus datos permanecerán guardados." />}
      {stage === 'current' && <Status icon={<CheckCircle2 size={28} />} title="La aplicación está actualizada" text="No hay una versión más nueva publicada en el canal oficial." />}
      {stage === 'error' && <Status danger icon={<AlertTriangle size={28} />} title="No se pudo completar" text={error || 'Ocurrió un error inesperado.'} />}
    </Modal>
  )
}

function Status({ icon, title, text, danger = false }: { icon: ReactNode; title: string; text: string; danger?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${danger ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><div className="flex items-start gap-3"><span className={danger ? 'text-rose-600' : 'text-[var(--primary)]'}>{icon}</span><div><h3 className="text-sm font-extrabold">{title}</h3><p className="mt-1 text-sm font-medium leading-relaxed">{text}</p></div></div></div>
}

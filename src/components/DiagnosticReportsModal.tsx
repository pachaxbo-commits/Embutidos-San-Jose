import { useState } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { Modal } from './ui/Modal'
import { getDiagnosticReports, formatDiagnosticReport, tryCopyDiagnosticText, type ErrorDiagnosticReport } from '../lib/errorDiagnostics'

export function DiagnosticReportsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [reports] = useState<ErrorDiagnosticReport[]>(() => getDiagnosticReports())
  const [selectedCode, setSelectedCode] = useState(() => reports[0]?.code ?? '')
  const [copyFailed, setCopyFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const selected = reports.find(report => report.code === selectedCode) ?? reports[0] ?? null

  const copy = async () => {
    if (!selected) return
    const success = await tryCopyDiagnosticText(formatDiagnosticReport(selected))
    setCopied(success)
    setCopyFailed(!success)
  }

  return <Modal isOpen={isOpen} onClose={onClose} title="Diagnóstico de errores" subtitle="Reportes guardados solo en este dispositivo" size="lg" footer={selected ? <button type="button" onClick={() => void copy()} className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700"> <ClipboardCopy size={16} /> {copied ? 'Reporte copiado' : 'Copiar reporte seleccionado'}</button> : undefined}>
    {reports.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">Todavía no hay errores guardados en este dispositivo.</p> : <div className="grid min-w-0 gap-3">
      <p className="text-xs font-semibold leading-relaxed text-slate-600">Los reportes excluyen documentos y datos comerciales. Si el portapapeles no está disponible, podrás seleccionar el texto para copiarlo.</p>
      <div className="flex flex-wrap gap-2">{reports.map(report => <button key={report.code} type="button" onClick={() => { setSelectedCode(report.code); setCopyFailed(false); setCopied(false) }} className={`min-h-10 max-w-full rounded-lg border px-3 text-left text-xs font-bold ${report.code === selected?.code ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
        {report.code} · {new Date(report.occurredAt).toLocaleString('es-BO')} · {report.view}
      </button>)}</div>
      {selected && <>
        {copyFailed && <p role="status" className="text-xs font-bold text-amber-800">No se pudo copiar automáticamente. Selecciona el texto del reporte para copiarlo.</p>}
        <textarea aria-label="Reporte técnico seleccionable" readOnly onFocus={event => event.currentTarget.select()} className="h-64 w-full min-w-0 rounded-xl border border-slate-300 bg-slate-50 p-3 font-mono text-[10px] text-slate-700" value={formatDiagnosticReport(selected)} />
      </>}
    </div>}
  </Modal>
}

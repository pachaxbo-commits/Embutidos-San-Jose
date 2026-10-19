import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw, Home, Copy } from 'lucide-react'
import { formatDiagnosticReport, recordErrorDiagnostic, tryCopyDiagnosticText, type ErrorDiagnosticReport } from '../lib/errorDiagnostics'

interface Props {
  children: ReactNode
  onReset?: () => void
  fallbackTitle?: string
  viewName?: string
}

interface State {
  hasError: boolean
  error: Error | null
  report: ErrorDiagnosticReport | null
  copyFailed: boolean
  copied: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    report: null,
    copyFailed: false,
    copied: false,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, report: null, copyFailed: false, copied: false }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const report = recordErrorDiagnostic({ error, componentStack: errorInfo.componentStack, source: 'react_render', view: this.props.viewName })
    console.error('[ErrorBoundary caught error]', {
      code: report.code,
      message: report.message,
      stack: report.stack,
      componentStack: report.componentStack,
    })
    this.setState({ report })
  }

  public copyReport = async () => {
    if (!this.state.report) return
    const text = formatDiagnosticReport(this.state.report)
    const copied = await tryCopyDiagnosticText(text)
    this.setState({ copied, copyFailed: !copied })
  }

  public handleRetry = () => {
    this.setState({ hasError: false, error: null, copyFailed: false, copied: false })
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null, copyFailed: false, copied: false })
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      window.location.hash = ''
      window.location.reload()
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[320px] w-full flex items-center justify-center p-6 bg-[#FAF7F2]">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 mb-4">
              <AlertCircle size={24} />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              {this.props.fallbackTitle || 'Se produjo un error al mostrar esta sección.'}
            </h2>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">
              Ocurrió un problema inesperado al procesar la información. Puedes reintentar o volver a la pantalla principal.
            </p>
            {this.state.report && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p className="font-bold">Código de error: {this.state.report.code}</p>
              <p className="mt-1">Copia este reporte y envíalo a soporte para identificar el problema.</p>
            </div>}
            <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <RefreshCw size={14} /> Reintentar
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary,#B91C1C)] px-4 py-2.5 text-xs font-bold text-white hover:opacity-90 transition-opacity"
              >
                <Home size={14} /> Volver al inicio
              </button>
              <button
                type="button"
                onClick={() => void this.copyReport()}
                disabled={!this.state.report}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <Copy size={14} /> {this.state.copied ? 'Reporte copiado' : 'Copiar reporte del error'}
              </button>
            </div>
            {this.state.copyFailed && this.state.report && <textarea
              aria-label="Reporte técnico seleccionable"
              readOnly
              onFocus={event => event.currentTarget.select()}
              className="mt-3 h-28 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-left font-mono text-[10px] text-slate-700"
              value={formatDiagnosticReport(this.state.report)}
            />}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
  onReset?: () => void
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]', error, errorInfo)
  }

  public handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null })
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
            <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
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
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

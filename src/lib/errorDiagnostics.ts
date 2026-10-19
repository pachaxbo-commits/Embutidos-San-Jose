export type DiagnosticCategory = 'render' | 'asynchronous' | 'permission' | 'synchronization' | 'data' | 'unknown'
export type DiagnosticSource = 'react_render' | 'window_error' | 'unhandled_rejection'

export interface DiagnosticEvent {
  at: string
  stage: 'before_confirmation' | 'operation_sent' | 'confirmation_received' | 'closure_snapshot' | 'dispatch_removed' | 'post_close_render'
  status?: 'draft' | 'warehouse_done' | 'closed' | 'reopened' | 'open' | 'none'
}

export interface ErrorDiagnosticReport {
  code: string
  occurredAt: string
  appVersion: string
  build: string
  browser: string
  operatingSystem: string
  view: string
  source: DiagnosticSource
  category: DiagnosticCategory
  errorName: string
  message: string
  stack: string
  componentStack: string
  recentEvents: DiagnosticEvent[]
}

const REPORTS_KEY = 'san-jose:error-diagnostics:v1'
const EVENTS_KEY = 'san-jose:error-events:v1'
const MAX_REPORTS = 3
const MAX_EVENTS = 20
const MAX_FIELD_LENGTH = 2400
const MAX_REPORT_LENGTH = 12_000
const recentFingerprints = new Map<string, { time: number; report: ErrorDiagnosticReport }>()
let globalHandlersInstalled = false

const redact = (value: unknown, limit = MAX_FIELD_LENGTH) => {
  let text = String(value ?? '')
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[TOKEN REDACTED]')
    .replace(/AIza[\w-]{20,}/g, '[KEY REDACTED]')
    .replace(/(password|token|authorization|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/(cliente|customer|nombre|responsable|distribuidor|usuario)\s*[:=]\s*[^,;\n]+/gi, '$1=[DATO REDACTADO]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL REDACTED]')
    .replace(/\bBs\.?\s*\d[\d.,]*/gi, '[MONTO REDACTED]')
    .replace(/\b\+?\d[\d\s().-]{6,}\d\b/g, '[TELÉFONO/ID REDACTADO]')
  return text.slice(0, limit)
}

const classify = (message: string, source: DiagnosticSource): DiagnosticCategory => {
  if (source === 'react_render') return 'render'
  if (/permission-denied|missing or insufficient permissions|unauthorized/i.test(message)) return 'permission'
  if (/offline|network|unavailable|deadline-exceeded|timed out|sin conexión/i.test(message)) return 'synchronization'
  if (/invalid data|invalid argument|cannot read|undefined|null|parse|serialize/i.test(message)) return 'data'
  return source === 'unhandled_rejection' ? 'asynchronous' : 'unknown'
}

const browserAndOs = () => {
  try {
    const ua = navigator.userAgent || ''
    const browser = /; wv\)|\bwv\b/i.test(ua)
      ? 'Android WebView'
      : /Edg\//.test(ua) ? 'Edge'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : 'Navegador desconocido'
    const operatingSystem = /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
        : /Windows/i.test(ua) ? 'Windows'
          : /Mac OS/i.test(ua) ? 'macOS'
            : /Linux/i.test(ua) ? 'Linux' : 'Sistema desconocido'
    return { browser, operatingSystem }
  } catch {
    return { browser: 'Desconocido', operatingSystem: 'Desconocido' }
  }
}

const getSafeCurrentView = () => {
  try {
    const candidate = window.location.hash.replace(/^#/, '')
    return /^dist\.[a-z-]+$/.test(candidate) ? candidate : 'aplicación'
  } catch {
    return 'aplicación'
  }
}

const safeRead = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

const safeWrite = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const getRecentDiagnosticEvents = (): DiagnosticEvent[] => {
  const value = safeRead<DiagnosticEvent[]>(EVENTS_KEY, [])
  return Array.isArray(value) ? value.slice(-MAX_EVENTS) : []
}

export const recordDiagnosticEvent = (stage: DiagnosticEvent['stage'], status?: DiagnosticEvent['status']) => {
  const event: DiagnosticEvent = { at: new Date().toISOString(), stage, ...(status ? { status } : {}) }
  const events = [...getRecentDiagnosticEvents(), event].slice(-MAX_EVENTS)
  safeWrite(EVENTS_KEY, events)
}

export const getDiagnosticReports = (): ErrorDiagnosticReport[] => {
  const value = safeRead<ErrorDiagnosticReport[]>(REPORTS_KEY, [])
  return Array.isArray(value) ? value.filter(item => item && typeof item.code === 'string').slice(-MAX_REPORTS).reverse() : []
}

export const recordErrorDiagnostic = (input: {
  error: Error
  componentStack?: string | null
  source: DiagnosticSource
  view?: string
}): ErrorDiagnosticReport => {
  const message = redact(input.error?.message || 'Error sin mensaje', 1200)
  const stack = redact(input.error?.stack || '', 3600)
  const componentStack = redact(input.componentStack || '', 2400)
  const fingerprint = `${input.error?.name || 'Error'}|${message}|${componentStack}`
  const prior = recentFingerprints.get(fingerprint)
  if (prior && Date.now() - prior.time < 3000) return prior.report

  const environment = browserAndOs()
  const randomCode = (() => {
    try {
      const bytes = new Uint8Array(3)
      crypto.getRandomValues(bytes)
      return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()
    } catch {
      return Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, '0')
    }
  })()
  const report: ErrorDiagnosticReport = {
    code: `ERR-${randomCode}`,
    occurredAt: new Date().toISOString(),
    appVersion: redact(import.meta.env.VITE_APP_VERSION || 'no disponible', 40),
    build: redact(import.meta.env.VITE_APP_BUILD || 'no disponible', 48),
    ...environment,
    view: redact(input.view || 'aplicación', 80),
    source: input.source,
    category: classify(message, input.source),
    errorName: redact(input.error?.name || 'Error', 80),
    message,
    stack,
    componentStack,
    recentEvents: getRecentDiagnosticEvents(),
  }
  const reports = [...getDiagnosticReports().reverse(), report].slice(-MAX_REPORTS)
  safeWrite(REPORTS_KEY, reports)
  recentFingerprints.set(fingerprint, { time: Date.now(), report })
  for (const [key, value] of recentFingerprints) if (Date.now() - value.time > 10_000) recentFingerprints.delete(key)
  return report
}

export const installGlobalErrorDiagnostics = () => {
  if (globalHandlersInstalled || typeof window === 'undefined') return () => undefined
  globalHandlersInstalled = true
  const onError = (event: ErrorEvent) => {
    if (!event.error) return
    recordErrorDiagnostic({ error: event.error instanceof Error ? event.error : new Error('Error de ejecución'), source: 'window_error', view: getSafeCurrentView() })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    const error = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Promesa rechazada sin detalle textual')
    recordErrorDiagnostic({ error, source: 'unhandled_rejection', view: getSafeCurrentView() })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    globalHandlersInstalled = false
  }
}

export const formatDiagnosticReport = (report: ErrorDiagnosticReport) => {
  const formatted = JSON.stringify(report, null, 2)
  return formatted.length <= MAX_REPORT_LENGTH ? formatted : `${formatted.slice(0, MAX_REPORT_LENGTH - 30)}\n[reporte truncado]`
}

export const tryCopyDiagnosticText = async (text: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // El fallback DOM funciona en WebView y navegadores sin permiso Clipboard.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', 'true')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  } catch {
    return false
  }
}

export const diagnosticReportSummary = (report: ErrorDiagnosticReport) => ({
  code: report.code,
  occurredAt: report.occurredAt,
  category: report.category,
  view: report.view,
})

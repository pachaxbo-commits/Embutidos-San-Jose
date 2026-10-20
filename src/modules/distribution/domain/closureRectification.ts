import type { DistClosure } from '../types.ts'

/** Presentation only: never writes or changes the preserved Firestore snapshot. */
export function closureRectificationView(closure: DistClosure, mode: 'original' | 'corrected' = 'corrected'): DistClosure {
  const audit = closure.rectification
  if (!audit || audit.version !== 1 || audit.closureId !== closure.id) return closure
  return { ...closure, ...(mode === 'original' ? audit.original : audit.corrected), rectification: audit,
    rectificationId: audit.id, rectificationView: mode }
}

export function closureRectificationLabel(closure: DistClosure): string {
  if (!closure.rectification) return ''
  return closure.rectificationView === 'original' ? 'ORIGINAL PRESERVADO · EXISTE RECTIFICACIÓN' : 'RECTIFICADO · CIERRE CONCILIADO'
}

import { useState, useMemo } from 'react'
import { AlertCircle, ChevronRight, X, Clock, User, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { formatBs, formatQty } from './shared'
import type { DistSale } from '../types'
import {
  getSaleAuditSummary,
  getUnseenSaleCorrections,
  markSaleCorrectionsSeen,
} from '../domain/saleCorrectionAudit'

interface SaleCorrectionAlertsProps {
  sales: DistSale[]
  userUid: string
  role: string
  onSelectSale?: (sale: DistSale) => void
}

export function SaleCorrectionAlerts({
  sales,
  userUid,
  role,
}: SaleCorrectionAlertsProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [dismissedLocally, setDismissedLocally] = useState(false)

  // Solo administradores reciben esta notificación
  const unseenSales = useMemo(() => {
    if (role !== 'admin' || dismissedLocally) return []
    return getUnseenSaleCorrections(sales, userUid)
  }, [sales, userUid, role, dismissedLocally])

  if (unseenSales.length === 0) return null

  const handleOpenModal = () => {
    // Al abrir, marcamos como vistas
    const keys = unseenSales.map(
      (s) => s.latestCorrectionId || `${s.id}_rev${s.revision || 1}`,
    )
    markSaleCorrectionsSeen(userUid, keys)
    setModalOpen(true)
  }

  const handleDismissAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    const keys = unseenSales.map(
      (s) => s.latestCorrectionId || `${s.id}_rev${s.revision || 1}`,
    )
    markSaleCorrectionsSeen(userUid, keys)
    setDismissedLocally(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setDismissedLocally(true)
  }

  return (
    <>
      <div className="w-full rounded-2xl border border-amber-300 bg-amber-50/95 p-2.5 sm:p-3 text-amber-950 shadow-sm transition">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-black shadow-xs">
              <AlertCircle size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black tracking-wide text-amber-950 uppercase truncate">
                {unseenSales.length} {unseenSales.length === 1 ? 'VENTA CORREGIDA' : 'VENTAS CORREGIDAS'}
              </p>
              <p className="text-[10px] font-semibold text-amber-800 truncate">
                Modificaciones auditadas recientes pendientes de revisión
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenModal}
              className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-amber-700 active:scale-95 transition"
            >
              <span>Ver cambios</span>
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={handleDismissAll}
              title="Descartar notificación"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-200 bg-white/80 text-amber-700 hover:bg-white hover:text-amber-900 active:scale-95 transition"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        title="Correcciones recientes de ventas"
        subtitle={`${unseenSales.length} ${unseenSales.length === 1 ? 'venta auditada' : 'ventas auditadas'}`}
        size="lg"
      >
        <div className="grid gap-3">
          <div className="max-h-[60dvh] overflow-y-auto pr-1 space-y-3">
            {unseenSales.map((sale) => {
              const audit = getSaleAuditSummary(sale)
              return (
                <article
                  key={sale.id}
                  className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 text-slate-800 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-amber-200/70 pb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900">
                          {sale.id.slice(-8).toUpperCase()}
                        </span>
                        <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[9px] font-black text-amber-800 uppercase tracking-wide">
                          CORREGIDA
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] font-bold text-slate-700">
                        Cliente: {sale.customerName || 'Venta contado sin cliente'}
                      </p>
                      <p className="text-[10px] font-medium text-slate-500">
                        Distribuidor: {sale.sellerName || 'No especificado'} · {sale.routeName || 'Ruta'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black tabular-nums text-slate-900">
                        {formatBs(sale.total)}
                      </p>
                      {audit.moneyDelta !== 0 && (
                        <p className={`text-[10px] font-extrabold tabular-nums ${audit.moneyDelta < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {audit.moneyDelta > 0 ? `+${formatBs(audit.moneyDelta)}` : formatBs(audit.moneyDelta)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <User size={12} className="text-slate-400" />
                        Corregida por: <strong>{sale.editedBy || audit.correctedBy || 'Administración'}</strong>
                      </span>
                      {sale.editedAt && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} className="text-slate-400" />
                          {new Date(sale.editedAt).toLocaleString('es-BO')}
                        </span>
                      )}
                    </div>

                    {sale.editReason && (
                      <p className="text-[11px] font-semibold text-amber-900 bg-amber-100/60 rounded-xl px-2.5 py-1">
                        Motivo: {sale.editReason}
                      </p>
                    )}

                    <div className="mt-2 rounded-xl bg-white border border-slate-200/80 p-2.5">
                      <p className="text-[10px] font-extrabold uppercase text-slate-400 mb-1.5 tracking-wide">
                        Cambios en productos
                      </p>
                      <div className="space-y-1">
                        {audit.lineChanges.map((change) => {
                          if (change.status === 'eliminated') {
                            return (
                              <div
                                key={change.productId}
                                className="flex items-center justify-between text-[11px] text-rose-700 font-bold bg-rose-50/70 px-2 py-1 rounded-lg"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Trash2 size={12} className="text-rose-500 shrink-0" />
                                  <span>{change.productName}:</span>
                                  <span className="line-through text-slate-400">
                                    {formatQty(change.qtyBefore, change.unitType)}
                                  </span>
                                  <span className="rounded bg-rose-100 border border-rose-200 px-1 py-0.2 text-[9px] font-black uppercase text-rose-800">
                                    ELIMINADA
                                  </span>
                                </span>
                                <span className="text-[10px] font-semibold text-rose-600">
                                  +{formatQty(change.returnedStockToRoute, change.unitType)} a ruta
                                </span>
                              </div>
                            )
                          }
                          if (change.status === 'modified') {
                            return (
                              <div
                                key={change.productId}
                                className="flex items-center justify-between text-[11px] text-slate-700 bg-slate-50 px-2 py-1 rounded-lg"
                              >
                                <span>
                                  <strong>{change.productName}:</strong>{' '}
                                  {formatQty(change.qtyBefore, change.unitType)} →{' '}
                                  <span className="font-bold text-slate-900">
                                    {formatQty(change.qtyAfter, change.unitType)}
                                  </span>
                                </span>
                                {change.returnedStockToRoute > 0 && (
                                  <span className="text-[10px] font-semibold text-emerald-700">
                                    +{formatQty(change.returnedStockToRoute, change.unitType)} a ruta
                                  </span>
                                )}
                              </div>
                            )
                          }
                          if (change.status === 'added') {
                            return (
                              <div
                                key={change.productId}
                                className="flex items-center justify-between text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg font-bold"
                              >
                                <span>
                                  {change.productName}: +{formatQty(change.qtyAfter, change.unitType)} (agregado)
                                </span>
                              </div>
                            )
                          }
                          return null
                        })}
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition"
            >
              Entendido
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

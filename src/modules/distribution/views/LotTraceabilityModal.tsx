import { useState, useEffect } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Layers,
  Package,
  Search,
  ShoppingBag,
  Truck,
  User,
  X,
} from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { TextInput } from '../../../components/ui/Form'
import { loadFullLotTraceability, searchLotsByCode } from '../data/distributionRepository'
import type { LotTraceabilityData } from '../domain/lotTraceability'
import { resolveLotSearchResults } from '../domain/lotSearch'
import type { DistLot, DistProduct, DistRoute } from '../types'
import { visiblePersonName } from './displayText'
import { formatQty, SecondaryButton } from './shared'

interface LotTraceabilityModalProps {
  isOpen: boolean
  onClose: () => void
  lotId?: string | null
  lotCode?: string
  productId?: string
  initialLot?: DistLot
  product?: DistProduct
  products?: DistProduct[]
  routes?: DistRoute[]
}

export function LotTraceabilityModal(props: LotTraceabilityModalProps) {
  const { isOpen, onClose, lotId, lotCode, productId, initialLot, product, products = [], routes = [] } = props
  const [userSelectedLot, setUserSelectedLot] = useState<DistLot | null>(null)

  const activeLotId = userSelectedLot?.id || lotId || null
  const activeLotCode = userSelectedLot?.lotCode || lotCode
  const activeInitialLot = userSelectedLot || initialLot
  const activeProductId = userSelectedLot?.productId || initialLot?.productId || productId
  const activeProduct = products.find((item) => item.id === activeProductId) || (product?.id === activeProductId ? product : undefined)

  const [loadedLotKey, setLoadedLotKey] = useState<string | null>(null)
  const [data, setData] = useState<LotTraceabilityData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTimeline, setShowTimeline] = useState(false)

  const currentLotKey = activeLotId ? `${activeLotId}:${activeProductId || ''}:${activeLotCode || ''}` : null
  const loading = Boolean(isOpen && activeLotId && loadedLotKey !== currentLotKey)

  // Local lot search bar inside the modal
  const [searchTerm, setSearchTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<DistLot[]>([])
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !activeLotId || !currentLotKey) {
      return
    }

    let isMounted = true

    loadFullLotTraceability({
      lotId: activeLotId,
      lotCode: activeLotCode,
      productId: activeProduct?.id || activeProductId,
      existingLot: activeInitialLot,
      existingProduct: activeProduct,
      skipProductLookup: true,
      routes,
    })
      .then((result) => {
        if (isMounted) {
          setData(result)
          setError(null)
          setLoadedLotKey(currentLotKey)
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError((err as Error).message || 'No se pudo cargar la trazabilidad del lote.')
          setData(null)
          setLoadedLotKey(currentLotKey)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, activeLotId, activeLotCode, activeInitialLot, activeProduct, activeProductId, routes, currentLotKey])

  const handleClose = () => {
    setUserSelectedLot(null)
    setData(null)
    setError(null)
    setLoadedLotKey(null)
    setSearchTerm('')
    setSearchResults([])
    setSearchFeedback(null)
    setShowTimeline(false)
    onClose()
  }

  const handleSearchLot = async () => {
    const code = searchTerm.trim()
    if (!code) return
    setSearching(true)
    setSearchFeedback(null)
    setSearchResults([])
    try {
      const results = await searchLotsByCode(code, productId)
      if (results.length === 0) {
        setSearchFeedback(`No se encontró ningún lote con el código "${code}".`)
      } else {
        setSearchResults(results)
      }
    } catch (err) {
      setSearchFeedback((err as Error).message || 'Error al buscar el lote.')
    } finally {
      setSearching(false)
    }
  }

  if (!isOpen) return null

  const unitType = data?.identification.unitType || activeInitialLot?.unitType || activeProduct?.unitType || 'unit'
  const isExhausted = data ? data.summary.currentStock <= 0 : false

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Trazabilidad del lote"
      subtitle={
        data
          ? `${data.identification.productName} · Lote ${data.identification.lotCode}`
          : activeLotCode
          ? `Consultando historial de Lote ${activeLotCode}…`
          : 'Consulta y seguimiento histórico de lotes'
      }
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={handleClose}>
            <X size={15} /> Cerrar
          </SecondaryButton>
        </div>
      }
    >
      <div className="grid gap-4">
        {/* Barra de búsqueda de lote */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 block text-[11px] font-bold text-slate-700">
            Buscar lote por código (rastrea activos y agotados con 0 existencias)
          </label>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[180px] flex-1">
              <TextInput
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Código de lote (ej: 101126)…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSearchLot()
                }}
              />
            </div>
            <SecondaryButton disabled={searching || !searchTerm.trim()} onClick={() => void handleSearchLot()}>
              <Search size={14} /> {searching ? 'Buscando…' : 'Rastrear lote'}
            </SecondaryButton>
          </div>
          {searchFeedback && (
            <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
              {searchFeedback}
            </p>
          )}

          {searchResults.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2.5">
              <p className="text-xs font-bold text-slate-800">
                Se encontraron {searchResults.length} lotes con el código &quot;{searchTerm}&quot;. Selecciona uno:
              </p>
              <div className="mt-2 grid gap-1.5">
                {resolveLotSearchResults(searchResults, products).map(({ lot: res, productName, currentStock }) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => {
                      setUserSelectedLot(res)
                      setSearchResults([])
                      setLoadedLotKey(null)
                    }}
                    className="grid min-w-0 gap-2 rounded-lg border border-slate-200 p-3 text-left text-xs transition-colors hover:border-indigo-400 hover:bg-indigo-50/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <span className="block break-words font-extrabold text-slate-900">Lote {res.lotCode}</span>
                      <span className="block break-words font-bold text-slate-800">{productName}</span>
                      {res.processingBatchId && <span className="block break-words text-xs text-slate-600">Envasado {res.packagedOn || res.createdAt?.slice(0, 10)} · Elaboración {res.processingBatchId.slice(-8)}</span>}
                      <p className="mt-1 break-words text-[10px] text-slate-500">
                        {currentStock > 0
                          ? `${formatQty(currentStock, res.unitType)} disponibles`
                          : '0 existencias · Lote agotado'} ·{' '}
                        Elaboración: {res.manufacturedOn || 'No registrada'} · Vence: {res.expiresOn || 'No registrada'}
                      </p>
                    </div>
                    <span className="justify-self-start rounded bg-indigo-100 px-2 py-1 text-[10px] font-extrabold text-indigo-900 sm:justify-self-end">
                      Ver trazabilidad
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-800" />
            <p className="mt-3 text-sm font-semibold text-slate-600">
              Reconstruyendo la cadena de trazabilidad del lote…
            </p>
            <p className="text-xs text-slate-400">Verificando ingresos, despachos a ruta y asignaciones a clientes</p>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-800">
            {error}
          </div>
        )}

        {!loading && !activeLotId && !data && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
            <Compass size={32} className="mx-auto text-slate-400" />
            <p className="mt-2 text-sm font-extrabold text-slate-700">Ningún lote seleccionado</p>
            <p className="mt-1 text-xs text-slate-500">
              Escribe el código del lote arriba (ej: <strong>101126</strong>) y presiona &quot;Rastrear lote&quot; para consultar su historial completo.
            </p>
          </div>
        )}

        {!loading && data && (
          <>
            {/* 1. Identificación y Estado */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-white">
                    <Layers size={15} />
                  </span>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Código de lote</span>
                    <p className="text-sm font-black text-slate-900">{data.identification.lotCode}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {isExhausted ? (
                    <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-black text-slate-700">
                      Lote agotado (0 existencias)
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800">
                      Con existencia: {formatQty(data.summary.currentStock, unitType)}
                    </span>
                  )}
                  {data.identification.isProcessingLot && (
                    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-extrabold text-indigo-900">
                      Sacheteado / Elaboración
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <span className="text-[10px] text-slate-500">Producto</span>
                  <p className="font-bold text-slate-800">{data.identification.productName}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">Elaboración / Lote</span>
                  <p className="font-bold text-slate-800">{data.identification.manufacturedOn || 'No registrada'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">Vencimiento</span>
                  <p className="font-bold text-slate-800">{data.identification.expiresOn || 'No registrado'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">Ingreso inicial</span>
                  <p className="font-bold text-slate-800">
                    {formatQty(data.identification.initialIntakeQuantity, unitType)}
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Resumen de Flujo Físico */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ingresaron</span>
                <p className="text-sm font-black text-slate-900">{formatQty(data.summary.intakeQuantity, unitType)}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-2.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Despachados</span>
                <p className="text-sm font-black text-blue-900">{formatQty(data.summary.dispatchedQuantity, unitType)}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-2.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Entregados</span>
                <p className="text-sm font-black text-emerald-900">{formatQty(data.summary.soldQuantity, unitType)}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-2.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Retornados</span>
                <p className="text-sm font-black text-amber-900">{formatQty(data.summary.returnedQuantity, unitType)}</p>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-2.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Mermas</span>
                <p className="text-sm font-black text-rose-900">{formatQty(data.summary.wasteQuantity, unitType)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saldo actual</span>
                <p className={`text-sm font-black ${data.summary.currentStock > 0 ? 'text-emerald-900' : 'text-slate-600'}`}>
                  {formatQty(data.summary.currentStock, unitType)}
                </p>
              </div>
            </div>

            {/* 3. Requerimiento Principal: "¿A quiénes se entregó?" */}
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-800">
                  <ShoppingBag size={14} className="text-emerald-700" />
                  ¿A quiénes se entregaron estos productos?
                  <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.2 text-[10px] font-extrabold text-emerald-800">
                    {data.deliveries.length} {data.deliveries.length === 1 ? 'venta' : 'ventas'}
                  </span>
                </h3>
                <span className="text-[11px] font-semibold text-slate-500">
                  Total entregado: {formatQty(data.summary.soldQuantity, unitType)}
                </span>
              </div>

              {data.deliveries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                  No se registran ventas para este lote todavía (el producto puede seguir en almacén o haber sido despachado sin ventas confirmadas).
                </div>
              ) : (
                <div className="grid max-h-[45vh] gap-2 overflow-y-auto overscroll-contain pr-1">
                  {data.deliveries.map((delivery, index) => (
                    <article
                      key={`${delivery.saleId}_${index}`}
                      className="grid gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xs hover:border-slate-300"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-extrabold text-slate-900">
                            {visiblePersonName(delivery.customerName)}
                          </p>
                          <p className="text-[11px] font-medium text-slate-500">
                            {new Date(delivery.createdAt).toLocaleString('es-BO')}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-sm font-black tabular-nums text-emerald-900">
                            {formatQty(delivery.deliveredQuantity, delivery.unitType)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                        {delivery.routeName && (
                          <span className="flex items-center gap-1">
                            <Truck size={12} className="text-slate-400" /> {delivery.routeName}
                          </span>
                        )}
                        {delivery.sellerName && (
                          <span className="flex items-center gap-1">
                            <User size={12} className="text-slate-400" /> {visiblePersonName(delivery.sellerName)}
                          </span>
                        )}
                        {delivery.receiptNumber && (
                          <span className="text-slate-500">N.º {delivery.receiptNumber}</span>
                        )}
                        {delivery.paymentMethod && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                            {delivery.paymentMethod === 'cash'
                              ? 'Efectivo'
                              : delivery.paymentMethod === 'transfer'
                              ? 'QR'
                              : delivery.paymentMethod === 'credit'
                              ? 'Crédito'
                              : delivery.paymentMethod}
                          </span>
                        )}
                      </div>

                      {delivery.note && (
                        <p className="text-[10px] text-slate-500">Nota: {delivery.note}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* 4. Cadena Cronológica de Trazabilidad */}
            <section className="grid gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setShowTimeline((prev) => !prev)}
                className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
              >
                <span className="flex items-center gap-1.5">
                  <Compass size={14} />
                  Cadena completa de movimientos ({data.timeline.length} eventos)
                </span>
                {showTimeline ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showTimeline && (
                <div className="grid max-h-[40vh] gap-2 overflow-y-auto pr-1">
                  {data.timeline.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-2.5 text-xs"
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          event.stepType === 'intake'
                            ? 'bg-slate-800 text-white'
                            : event.stepType === 'dispatch'
                            ? 'bg-blue-100 text-blue-800'
                            : event.stepType === 'sale'
                            ? 'bg-emerald-100 text-emerald-800'
                            : event.stepType === 'return'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {event.stepType === 'intake' ? (
                          <Package size={11} />
                        ) : event.stepType === 'dispatch' ? (
                          <Truck size={11} />
                        ) : event.stepType === 'sale' ? (
                          <CheckCircle2 size={11} />
                        ) : (
                          <Clock size={11} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <p className="font-extrabold text-slate-800">{event.label}</p>
                          <strong className="text-slate-900">{formatQty(event.quantity, event.unitType)}</strong>
                        </div>
                        <p className="text-[10px] text-slate-400">{new Date(event.date).toLocaleString('es-BO')}</p>
                        {event.customerName && (
                          <p className="font-semibold text-emerald-950">Cliente: {event.customerName}</p>
                        )}
                        {event.routeName && <p className="text-[11px] text-slate-600">{event.routeName}</p>}
                        {event.responsibleName && (
                          <p className="text-[10px] text-slate-500">Por: {visiblePersonName(event.responsibleName)}</p>
                        )}
                        {event.note && <p className="text-[10px] text-slate-400">{event.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}

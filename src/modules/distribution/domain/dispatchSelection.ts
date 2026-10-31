import type { DistLot, DistProduct } from '../types'

const spanishSort = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

function dateKey(value?: string) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || ''
}

/** FIFO display: oldest manufacture date, falling back to the recorded intake date. */
export function dispatchLotFifoDate(lot: DistLot) {
  return dateKey(lot.manufacturedOn) || dateKey(lot.createdAt) || dateKey(lot.expiresOn) || '9999-12-31'
}

export function sortDispatchLotsFifo<T extends DistLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) =>
    dispatchLotFifoDate(a).localeCompare(dispatchLotFifoDate(b)) ||
    dateKey(a.expiresOn).localeCompare(dateKey(b.expiresOn)) ||
    dateKey(a.createdAt).localeCompare(dateKey(b.createdAt)) ||
    spanishSort.compare(a.lotCode || a.id, b.lotCode || b.id) ||
    a.id.localeCompare(b.id),
  )
}

/** Keep the existing FEFO suggestion explicit and deterministic. */
export function sortDispatchLotsFefo<T extends DistLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) =>
    (dateKey(a.expiresOn) || '9999-12-31').localeCompare(dateKey(b.expiresOn) || '9999-12-31') ||
    dispatchLotFifoDate(a).localeCompare(dispatchLotFifoDate(b)) ||
    spanishSort.compare(a.lotCode || a.id, b.lotCode || b.id) ||
    a.id.localeCompare(b.id),
  )
}

function compareDispatchProducts(a: DistProduct, b: DistProduct) {
  return spanishSort.compare(a.category || '', b.category || '') ||
    spanishSort.compare(a.name, b.name) ||
    a.id.localeCompare(b.id)
}

/** Default is category/name; a saved sequence takes precedence across categories. */
export function sortDispatchProducts<T extends DistProduct>(products: readonly T[], savedOrder?: readonly string[] | null): T[] {
  if (savedOrder?.length) {
    const positions = new Map<string, number>()
    savedOrder.forEach((id, index) => { if (!positions.has(id)) positions.set(id, index) })
    return [...products].sort((a, b) => {
      const aPosition = positions.get(a.id)
      const bPosition = positions.get(b.id)
      if (aPosition !== undefined && bPosition !== undefined) return aPosition - bPosition
      if (aPosition !== undefined) return -1
      if (bPosition !== undefined) return 1
      return compareDispatchProducts(a, b)
    })
  }
  return [...products].sort(compareDispatchProducts)
}

/** Move one product to another position while preserving every other product. */
export function moveDispatchProduct<T extends { id: string }>(products: readonly T[], fromId: string, toId: string): T[] {
  const from = products.findIndex(product => product.id === fromId)
  const to = products.findIndex(product => product.id === toId)
  if (from < 0 || to < 0 || from === to) return [...products]
  const next = [...products]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * If a catalog change adds active products after an order was saved, keep all
 * configured products in their exact sequence and append new ones by default.
 */
export function getDispatchProductIds(products: readonly DistProduct[], savedOrder?: readonly string[] | null): string[] {
  return sortDispatchProducts(products, savedOrder).map(product => product.id)
}

export interface DispatchLotDraftLine {
  id: string
  productId: string
  quantity: string
  dispatchMerma?: string
  allocations: Array<{ id: string; lotId: string; quantity: string }>
}

export interface DispatchLotIssue {
  key: string
  lineId: string
  allocationId?: string
  message: string
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function dispatchLotIneligibility(lot: DistLot, productId: string, location: string, today: string): string | null {
  if (lot.productId !== productId) return `pertenece a ${lot.productName || 'otro producto'}, no al producto elegido`
  if (!(Number(lot.quantities[location]) > 0)) return 'no tiene kilos o unidades disponibles en este almacén'
  if (lot.quarantined) return 'está en cuarentena y no puede salir en un despacho'
  if (lot.expiresOn && lot.expiresOn < today) return `está vencido desde ${lot.expiresOn}`

  const pendingOrigin = Number(lot.pendingOrigins?.[location]?.reduce((sum, row) => sum + Number(row.quantity || 0), 0) || 0)
  if (pendingOrigin > 0) return 'tiene origen físico pendiente de revisión'

  if (lot.processingCommercialBlocked) {
    const unavailable = lot.processingUnavailable?.[location]
    const isFinishedAndTraceable = lot.processingDestinationKind === 'finished'
      && Array.isArray(lot.processingByLocation?.[location]?.segments)
      && lot.processingByLocation[location].segments.length > 0
      && !Number(unavailable?.courtesy || 0)
      && !Number(unavailable?.repackPending || 0)
      && !Number(unavailable?.reviewHold || 0)
    if (!isFinishedAndTraceable) return 'proviene de sacheteado y todavía está bloqueado para despacho por trazabilidad o revisión'
  }
  return null
}

export function validateDispatchLotDrafts(
  lines: readonly DispatchLotDraftLine[],
  products: readonly DistProduct[],
  lots: readonly DistLot[],
  location: string,
  today: string,
): DispatchLotIssue[] {
  const issues: DispatchLotIssue[] = []
  const lotById = new Map(lots.map(lot => [lot.id, lot]))

  for (const line of lines) {
    const product = products.find(item => item.id === line.productId)
    if (!product) continue
    const quantity = Number(line.quantity)
    const dispatchMerma = product.unitType === 'kg' ? Number(line.dispatchMerma || 0) : 0
    const target = roundQuantity((Number.isFinite(quantity) ? quantity : 0) + (Number.isFinite(dispatchMerma) ? dispatchMerma : 0))
    const addIssue = (allocationId: string | undefined, message: string) => issues.push({
      key: `${line.id}:${allocationId || 'line'}:${issues.length}`,
      lineId: line.id,
      ...(allocationId ? { allocationId } : {}),
      message,
    })

    if (!(quantity > 0)) {
      addIssue(undefined, `Producto ${product.name}: indica una cantidad normal mayor a cero.`)
      continue
    }
    if (!line.allocations.length) {
      addIssue(undefined, `Producto ${product.name}: distribuye ${target} ${product.unitType} entre uno o más lotes.`)
      continue
    }

    const selectedIds = line.allocations.map(part => part.lotId).filter(Boolean)
    const totalsByLot = new Map<string, number>()
    const firstAllocationByLot = new Map<string, string>()

    for (const part of line.allocations) {
      const lotLabel = part.lotId ? (lotById.get(part.lotId)?.lotCode || part.lotId) : 'sin seleccionar'
      if (!part.lotId) {
        addIssue(part.id, `Producto ${product.name} · lote sin seleccionar: elige un lote disponible.`)
        continue
      }

      const lot = lotById.get(part.lotId)
      if (!lot) {
        addIssue(part.id, `Producto ${product.name} · lote ${lotLabel}: ya no aparece en inventario. Actualiza la pantalla y selecciona otro lote.`)
        continue
      }

      const reason = dispatchLotIneligibility(lot, product.id, location, today)
      if (reason) addIssue(part.id, `Producto ${product.name} · lote ${lot.lotCode || lot.id}: no se puede despachar porque ${reason}.`)

      const entered = Number(part.quantity)
      if (!Number.isFinite(entered) || !(entered > 0)) {
        addIssue(part.id, `Producto ${product.name} · lote ${lot.lotCode || lot.id}: ingresa una cantidad mayor a cero.`)
        continue
      }
      totalsByLot.set(part.lotId, roundQuantity((totalsByLot.get(part.lotId) || 0) + entered))
      firstAllocationByLot.set(part.lotId, firstAllocationByLot.get(part.lotId) || part.id)
    }

    for (const [lotId, entered] of totalsByLot) {
      const lot = lotById.get(lotId)
      if (!lot) continue
      const available = roundQuantity(Number(lot.quantities[location]) || 0)
      if (entered > available) {
        const excess = roundQuantity(entered - available)
        addIssue(firstAllocationByLot.get(lotId), `Producto ${product.name} · lote ${lot.lotCode || lot.id}: ingresado ${entered} ${product.unitType}, disponible ${available} ${product.unitType}; exceso ${excess} ${product.unitType}. Reduce la cantidad o elige otro lote.`)
      }
    }

    const duplicates = [...new Set(selectedIds)].filter(id => selectedIds.filter(value => value === id).length > 1)
    for (const lotId of duplicates) {
      const lot = lotById.get(lotId)
      addIssue(firstAllocationByLot.get(lotId), `Producto ${product.name} · lote ${lot?.lotCode || lotId}: está repetido. Deja una sola asignación para cada lote.`)
    }

    const assigned = roundQuantity([...totalsByLot.values()].reduce((sum, value) => sum + value, 0))
    if (Math.abs(assigned - target) >= 0.01) {
      const difference = roundQuantity(Math.abs(target - assigned))
      addIssue(undefined, assigned < target
        ? `Producto ${product.name}: faltan distribuir ${difference} ${product.unitType}. Asignado ${assigned} de ${target}.`
        : `Producto ${product.name}: sobran ${difference} ${product.unitType} asignados. Asignado ${assigned} de ${target}.`)
    }
  }

  return issues
}

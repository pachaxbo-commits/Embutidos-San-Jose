import type { DistLot, DistStockMovement, DistWarehouse } from '../../types.ts'
import { filterQuarantineRows, quarantineRows, summarizeQuarantine } from '../quarantine.ts'

const base = (patch: Partial<DistLot> = {}): DistLot => ({
  id: 'q-lot', restaurantId: 'sanjose', productId: 'viena', productName: 'Viena económico', unitType: 'kg',
  lotCode: 'SOBRANTE POR REVISAR', manufacturedOn: '', expiresOn: '', productionCost: null,
  quantities: { central: 0.02 }, quarantined: true, createdAt: '2026-10-16T12:00:00.000Z', createdBy: 'warehouse', ...patch,
})
const movement = (patch: Partial<DistStockMovement> = {}): DistStockMovement => ({
  id: 'overage-movement', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-16T12:00:00.000Z', createdBy: 'warehouse', dayKey: '2026-10-16', schemaVersion: 1,
  type: 'overage', productId: 'viena', productName: 'Viena económico', unitType: 'kg', quantity: 0.02, centralDelta: 0.02, routeDelta: 0,
  lotId: 'q-lot', dispatchId: 'dispatch-1', note: 'Sobrante detectado en cierre', ...patch,
})
const warehouses: DistWarehouse[] = [{ id: 'north', name: 'Zona Norte', active: true, restaurantId: 'sanjose' }]
const rows = quarantineRows([base(), base({ id: 'expired', quarantined: false, expiresOn: '2020-01-01', quantities: { central: 9 } }), base({ id: 'regular', quarantined: false, quantities: { central: 4 } })], [movement()], warehouses)
if (rows.length !== 1 || rows[0].source !== 'Sobrante de cierre' || rows[0].quantity !== 0.02) throw new Error('Solo el lote realmente quarantined debe estar en la bandeja, con su origen legible.')
if (filterQuarantineRows(rows, { status: 'pending', location: 'central', dayKeys: ['2026-10-16'] }).length !== 1) throw new Error('El filtro de pendiente/almacén/fecha debe encontrar el sobrante de cierre.')
if (filterQuarantineRows(rows, { status: 'pending', location: 'central', dayKeys: ['2026-10-17'] }).length !== 0) throw new Error('El periodo debe filtrar por fecha de ingreso.')
const totals = summarizeQuarantine([...rows, { ...rows[0], lot: { ...rows[0].lot, id: 'pack', unitType: 'package' }, quantity: 2 }])
if (totals.kg !== 0.02 || totals.package !== 2 || totals.unit !== 0) throw new Error('Los totales no deben sumar unidades incompatibles.')
const resolved = quarantineRows([base({ quarantineResolution: 'discarded', quarantineResolvedAt: '2026-10-17T12:00:00.000Z', quarantineResolvedByName: 'Admin', quarantineResolvedQuantity: 0.02, quarantineResolvedLocation: 'central', quarantineResolutionReason: 'Producto no apto', quantities: { central: 0 } })], [movement()], warehouses)
if (resolved.length !== 1 || resolved[0].status !== 'resolved' || resolved[0].resolutionLabel !== 'Descartado / no apto') throw new Error('Los registros resueltos deben permanecer en el historial.')
console.log('PASS quarantine domain: origen, estados, filtros, unidades y conservación del historial')

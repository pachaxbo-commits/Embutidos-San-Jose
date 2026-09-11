import {
  isReportInternalIdentifier,
  reportClosureLabel,
  reportCreditLabel,
  reportMovementLabel,
  reportPaymentLabel,
  reportPersonName,
  reportReceiptNumber,
  reportUnitLabel,
} from '../reportLabels.ts'

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Se esperaba ${String(expected)} y se obtuvo ${String(actual)}`)
}

assertEqual(reportPaymentLabel('cash'), 'Efectivo')
assertEqual(reportPaymentLabel('qr'), 'QR')
assertEqual(reportPaymentLabel('credit'), 'Crédito')
assertEqual(reportPaymentLabel('mixed'), 'Pago combinado')

assertEqual(reportClosureLabel('draft'), 'Devolución declarada')
assertEqual(reportClosureLabel('warehouse_done'), 'Devolución confirmada por Almacén')
assertEqual(reportClosureLabel('closed'), 'Cierre completado')
assertEqual(reportClosureLabel('reopened'), 'Cierre reabierto')

assertEqual(reportCreditLabel('OPEN'), 'Pendiente')
assertEqual(reportCreditLabel('PARTIAL'), 'Pago parcial')
assertEqual(reportCreditLabel('PAID'), 'Pagado')

assertEqual(reportUnitLabel('unit'), 'unidad')
assertEqual(reportUnitLabel('package'), 'paquete')
assertEqual(reportMovementLabel('dispatch_addition'), 'Aumento de despacho')
assertEqual(reportMovementLabel('customer_return'), 'Devolución del cliente')

assertEqual(isReportInternalIdentifier('lF6A21suP1tVgk9LUW6FHTLXx2rk'), true)
assertEqual(reportPersonName('lF6A21suP1tVgk9LUW6FHTLXx2rk'), 'Usuario de registro anterior')
assertEqual(reportReceiptNumber('venta-anterior'), 'Venta anterior')
assertEqual(reportReceiptNumber('admin-direct-mtuaz8h7'), 'N.º UAZ8H7')

console.log('PASS etiquetas de reportes en español e identificadores protegidos')

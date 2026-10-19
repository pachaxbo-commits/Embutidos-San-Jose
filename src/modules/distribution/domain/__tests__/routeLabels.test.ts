import { isAssignableDistributorRoute, routeDisplayName, routeKindLabel } from '../routeLabels.ts'

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: esperado ${String(expected)}, obtenido ${String(actual)}`)
}

assertEqual(routeKindLabel('route'), 'Ruta distribuidor', 'tipo ruta estándar')
assertEqual(routeKindLabel('direct'), 'Impulsación', 'valor técnico legacy representa Impulsación')
assertEqual(routeDisplayName({ id: 'other-direct', name: 'Venta directa / Impulsacion', kind: 'direct' }), 'Impulsación', 'kind direct normaliza etiqueta histórica combinada')
assertEqual(routeDisplayName({ id: 'route-directa', name: 'Venta directa / Impulsación', kind: 'route' }), 'Impulsación', 'ID legacy se normaliza aunque el kind histórico sea route')
assertEqual(routeDisplayName({ id: 'route-impulsacion', name: 'Venta directa / Impulsación', kind: 'route' }), 'Impulsación', 'ID actual se normaliza aunque el kind sea route')
assertEqual(routeDisplayName({ id: 'north', name: 'Zona Norte', kind: 'route' }), 'Zona Norte', 'nombres ordinarios preservados')
assertEqual(routeDisplayName({ id: 'direct-sale', name: 'Venta directa', kind: 'route' }), 'Venta directa', 'una ruta normal no se convierte en Impulsación')
assertEqual(isAssignableDistributorRoute({ id: 'route-directa' }), true, 'Impulsación legacy sí es asignable')
assertEqual(isAssignableDistributorRoute({ id: 'route-impulsacion' }), true, 'Impulsación actual sí es asignable')
assertEqual(isAssignableDistributorRoute({ id: 'administracion' }), false, 'Administración no es ruta asignable')
assertEqual(isAssignableDistributorRoute({ id: 'admin' }), false, 'alias histórico de Administración no es asignable')

console.log('PASS etiquetas separadas de ruta e Impulsación')

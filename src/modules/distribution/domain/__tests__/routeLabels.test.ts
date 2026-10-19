import { routeDisplayName, routeKindLabel } from '../routeLabels.ts'

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: esperado ${String(expected)}, obtenido ${String(actual)}`)
}

assertEqual(routeKindLabel('route'), 'Ruta distribuidor', 'tipo ruta estándar')
assertEqual(routeKindLabel('direct'), 'Impulsación', 'valor técnico legacy representa Impulsación')
assertEqual(routeDisplayName({ name: 'Venta directa / Impulsacion', kind: 'direct' }), 'Impulsación', 'etiqueta histórica combinada normalizada solo al mostrar')
assertEqual(routeDisplayName({ name: 'Ruta Hugo', kind: 'route' }), 'Ruta Hugo', 'nombres ordinarios preservados')
assertEqual(routeDisplayName({ name: 'Venta directa', kind: 'route' }), 'Venta directa', 'venta directa no se convierte en Impulsación')

console.log('PASS etiquetas separadas de ruta e Impulsación')

import type { DistProduct, DistRoute } from '../types'

/**
 * Catalogo y rutas iniciales de Embutidos San Jose.
 *
 * Son valores de arranque: precios, presentaciones y rutas son editables desde
 * la aplicacion. Los ids son estables para que re-sembrar no duplique nada.
 */

type SeedProduct = Pick<
  DistProduct,
  'id' | 'name' | 'category' | 'presentation' | 'unitType' | 'referencePrice' | 'approximateWeightKg'
>

export const SAN_JOSE_PRODUCTS: SeedProduct[] = [
  // --- Productos al vacio ---
  {
    id: 'vac-viena-agua-10u-12cm',
    name: 'Salchicha tipo Viena para el agua',
    category: 'Al vacio',
    presentation: '10 unidades 12 cm (aprox. 350 g)',
    unitType: 'package',
    referencePrice: 20,
    approximateWeightKg: 0.35,
  },
  {
    id: 'vac-viena-agua-12u-19cm',
    name: 'Salchicha tipo Viena para el agua',
    category: 'Al vacio',
    presentation: '12 unidades 19 cm (aprox. 650 g)',
    unitType: 'package',
    referencePrice: 32,
    approximateWeightKg: 0.65,
  },
  {
    id: 'vac-viena-clasico-10u-12cm',
    name: 'Salchicha tipo Viena clasico',
    category: 'Al vacio',
    presentation: '10 unidades 12 cm (aprox. 450 g)',
    unitType: 'package',
    referencePrice: 24,
    approximateWeightKg: 0.45,
  },
  {
    id: 'vac-chorizo-parrillero-precocido-500',
    name: 'Chorizo parrillero precocido ahumado',
    category: 'Al vacio',
    presentation: 'Con/sin picante, aprox. 500 g',
    unitType: 'package',
    referencePrice: 28,
    approximateWeightKg: 0.5,
  },
  {
    id: 'vac-chorizo-criollo-1kg',
    name: 'Chorizo parrillero criollo',
    category: 'Al vacio',
    presentation: '1 kg',
    unitType: 'package',
    referencePrice: 57,
    approximateWeightKg: 1,
  },
  {
    id: 'vac-chorizo-criollo-500',
    name: 'Chorizo parrillero criollo',
    category: 'Al vacio',
    presentation: '500 g',
    unitType: 'package',
    referencePrice: 29,
    approximateWeightKg: 0.5,
  },
  {
    id: 'vac-chorizo-freir-1kg',
    name: 'Chorizo de freir',
    category: 'Al vacio',
    presentation: '1 kg',
    unitType: 'package',
    referencePrice: 55,
    approximateWeightKg: 1,
  },
  {
    id: 'vac-chorizo-freir-500',
    name: 'Chorizo de freir',
    category: 'Al vacio',
    presentation: '500 g',
    unitType: 'package',
    referencePrice: 28,
    approximateWeightKg: 0.5,
  },
  {
    id: 'vac-mortadela-jamonada-200',
    name: 'Mortadela jamonada',
    category: 'Al vacio',
    presentation: 'Sachet 200 g',
    unitType: 'package',
    referencePrice: 12,
    approximateWeightKg: 0.2,
  },
  {
    id: 'vac-mortadela-primavera-200',
    name: 'Mortadela primavera',
    category: 'Al vacio',
    presentation: 'Sachet 200 g',
    unitType: 'package',
    referencePrice: 12,
    approximateWeightKg: 0.2,
  },
  {
    id: 'vac-jamon-cerdo-200',
    name: 'Jamon de cerdo',
    category: 'Al vacio',
    presentation: 'Sachet 200 g',
    unitType: 'package',
    referencePrice: 13,
    approximateWeightKg: 0.2,
  },
  {
    id: 'vac-viena-coctelera-500',
    name: 'Salchicha tipo Viena coctelera',
    category: 'Al vacio',
    presentation: '500 g',
    unitType: 'package',
    referencePrice: 28,
    approximateWeightKg: 0.5,
  },
  {
    id: 'vac-tocino-ahumado-150',
    name: 'Tocino ahumado',
    category: 'Al vacio',
    presentation: 'Sachet 150 g',
    unitType: 'package',
    referencePrice: 17,
    approximateWeightKg: 0.15,
  },
  {
    id: 'vac-pate-higado-100',
    name: 'Pate de higado de cerdo',
    category: 'Al vacio',
    presentation: 'Aprox. 100 g',
    unitType: 'package',
    referencePrice: 7,
    approximateWeightKg: 0.1,
  },
  {
    id: 'vac-pate-higado-200',
    name: 'Pate de higado de cerdo',
    category: 'Al vacio',
    presentation: 'Aprox. 200 g',
    unitType: 'package',
    referencePrice: 13,
    approximateWeightKg: 0.2,
  },
  {
    id: 'vac-enrollado-cerdo-200',
    name: 'Enrollado de cerdo',
    category: 'Al vacio',
    presentation: 'Sachet aprox. 200 g',
    unitType: 'package',
    referencePrice: 15,
    approximateWeightKg: 0.2,
  },

  // --- Productos a granel (precio por kg) ---
  {
    id: 'gra-chorizo-parrillero-crudo',
    name: 'Chorizo parrillero crudo',
    category: 'Granel',
    presentation: 'Bs 57 / kg',
    unitType: 'kg',
    referencePrice: 57,
  },
  {
    id: 'gra-chorizo-parrillero-precocido',
    name: 'Chorizo parrillero precocido ahumado',
    category: 'Granel',
    presentation: 'Con/sin picante, Bs 53 / kg',
    unitType: 'kg',
    referencePrice: 53,
  },
  {
    id: 'gra-viena',
    name: 'Salchicha tipo Viena',
    category: 'Granel',
    presentation: 'Bs 48 / kg',
    unitType: 'kg',
    referencePrice: 48,
  },
  {
    id: 'gra-viena-agua',
    name: 'Salchicha tipo Viena para el agua',
    category: 'Granel',
    presentation: 'Bs 50 / kg',
    unitType: 'kg',
    referencePrice: 50,
  },
  {
    id: 'gra-jamon-cerdo',
    name: 'Jamon de cerdo',
    category: 'Granel',
    presentation: 'Bs 53 / kg',
    unitType: 'kg',
    referencePrice: 53,
  },
  {
    id: 'gra-mortadela',
    name: 'Mortadela primavera / jamonada',
    category: 'Granel',
    presentation: 'Bs 50 / kg',
    unitType: 'kg',
    referencePrice: 50,
  },
]

type SeedRoute = Pick<DistRoute, 'id' | 'name' | 'kind'>

export const SAN_JOSE_ROUTES: SeedRoute[] = [
  { id: 'route-norte', name: 'Zona Norte', kind: 'route' },
  { id: 'route-sud', name: 'Zona Sud', kind: 'route' },
  { id: 'route-sacaba', name: 'Sacaba', kind: 'route' },
  // La impulsacion no es un permiso aparte: es un canal con tipo 'direct'.
  { id: 'route-directa', name: 'Venta directa / Impulsacion', kind: 'direct' },
]

/** Distribuidores sugeridos para la demo (se crean desde la pantalla Usuarios) */
export const SAN_JOSE_SUGGESTED_DISTRIBUTORS = [
  { displayName: 'Hugo Herbas', routeId: 'route-norte' },
  { displayName: 'Ricardo Jimenez', routeId: 'route-sud' },
  { displayName: 'Lucio Marcani', routeId: 'route-sacaba' },
]

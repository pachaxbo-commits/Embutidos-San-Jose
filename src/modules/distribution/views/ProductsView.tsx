import { useMemo, useState } from 'react'
import { Plus, Search, Sparkles } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, SelectInput, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2 } from '../domain/engine'
import { saveProduct, saveRoute } from '../data/distributionRepository'
import { SAN_JOSE_PRODUCTS, SAN_JOSE_ROUTES } from '../seed/sanJoseSeed'
import { PrimaryButton, SecondaryButton, formatBs, unitLabel } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistProduct, UnitType } from '../types'

/**
 * Catalogo de SKU. Cada producto declara su unidad real (kg, unidad o paquete)
 * y su precio de referencia, que es solo el valor por defecto de la venta.
 */
export function ProductsView({ data }: DistributionViewProps) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<DistProduct | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Al vacio')
  const [presentation, setPresentation] = useState('')
  const [unitType, setUnitType] = useState<UnitType>('package')
  const [price, setPrice] = useState('0')
  const [weight, setWeight] = useState('')
  const [active, setActive] = useState(true)
  const [isSeeding, setIsSeeding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term
      ? data.products.filter(
          (product) => product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term),
        )
      : data.products
  }, [data.products, search])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setCategory('Al vacio')
    setPresentation('')
    setUnitType('package')
    setPrice('0')
    setWeight('')
    setActive(true)
    setError(null)
    setIsOpen(true)
  }

  const openEdit = (product: DistProduct) => {
    setEditing(product)
    setName(product.name)
    setCategory(product.category)
    setPresentation(product.presentation ?? '')
    setUnitType(product.unitType)
    setPrice(String(product.referencePrice))
    setWeight(product.approximateWeightKg ? String(product.approximateWeightKg) : '')
    setActive(product.active !== false)
    setError(null)
    setIsOpen(true)
  }

  const submit = async () => {
    if (!name.trim()) {
      setError('El nombre es obligatorio.')
      return
    }

    const id =
      editing?.id ||
      `sku-${name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)}-${Date.now().toString(36)}`

    await saveProduct({
      id,
      name: name.trim(),
      category,
      presentation: presentation.trim(),
      unitType,
      referencePrice: round2(Number(price)),
      approximateWeightKg: weight ? round2(Number(weight)) : undefined,
      active,
      sortOrder: editing?.sortOrder ?? data.products.length,
      createdAt: editing?.createdAt,
    })
    setIsOpen(false)
  }

  /** Siembra el catalogo inicial sin pisar lo que ya exista (ids estables). */
  const seedCatalog = async () => {
    setIsSeeding(true)
    try {
      const existingProducts = new Set(data.products.map((product) => product.id))
      const existingRoutes = new Set(data.routes.map((route) => route.id))

      let index = data.products.length
      for (const product of SAN_JOSE_PRODUCTS) {
        if (existingProducts.has(product.id)) continue
        await saveProduct({ ...product, active: true, sortOrder: index++ })
      }
      for (const route of SAN_JOSE_ROUTES) {
        if (existingRoutes.has(route.id)) continue
        await saveRoute({ ...route, active: true })
      }
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <Screen
      title="Productos"
      subtitle={`${data.products.length} SKU en catalogo`}
      actions={
        <PrimaryButton onClick={openCreate}>
          <Plus size={16} /> Nuevo
        </PrimaryButton>
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        {data.products.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <p className="text-xs font-bold text-slate-700">El catalogo esta vacio.</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              Puedes cargar el catalogo inicial de Embutidos San Jose y luego editar precios y presentaciones.
            </p>
            <div className="mt-3">
              <SecondaryButton disabled={isSeeding} onClick={() => void seedCatalog()}>
                <Sparkles size={16} /> {isSeeding ? 'Cargando...' : 'Cargar catalogo y rutas iniciales'}
              </SecondaryButton>
            </div>
          </div>
        )}

        <div className="relative w-full">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar producto..."
            className="pl-9"
          />
        </div>

        {filtered.length === 0 && data.products.length > 0 && <EmptyBlock title="Sin coincidencias" />}

        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => openEdit(product)}
              className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-extrabold text-slate-900">{product.name}</p>
                <p className="truncate text-[11px] font-semibold text-slate-500">
                  {product.presentation || product.category} · {unitLabel(product.unitType)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: 'var(--primary)' }}>
                {formatBs(product.referencePrice)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        footer={
          <PrimaryButton full onClick={() => void submit()}>
            Guardar producto
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Nombre" required>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Categoria / presentacion comercial">
            <SelectInput value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="Al vacio">Al vacio</option>
              <option value="Granel">Granel</option>
              <option value="Otros">Otros</option>
            </SelectInput>
          </Field>
          <Field label="Detalle de presentacion" hint="Ej: sachet 200 g, 10 unidades 12 cm">
            <TextInput value={presentation} onChange={(event) => setPresentation(event.target.value)} />
          </Field>
          <Field label="Unidad de venta" hint="Los reportes no convierten paquetes a kilos.">
            <SelectInput value={unitType} onChange={(event) => setUnitType(event.target.value as UnitType)}>
              <option value="kg">Granel (kg)</option>
              <option value="package">Paquete / sachet</option>
              <option value="unit">Unidad</option>
            </SelectInput>
          </Field>
          <Field label="Precio de referencia (Bs)" hint="El distribuidor puede modificarlo en cada venta.">
            <NumberInput value={price} min={0} step={0.5} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          {unitType !== 'kg' && (
            <Field label="Peso aproximado (kg)" hint="Informativo. No se usa para convertir reportes.">
              <NumberInput value={weight} min={0} step={0.05} onChange={(event) => setWeight(event.target.value)} />
            </Field>
          )}
          <label className="flex min-h-[44px] items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-5 w-5" />
            Producto activo
          </label>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>
    </Screen>
  )
}

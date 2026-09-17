import { useMemo, useState } from 'react'
import { ImagePlus, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2 } from '../domain/engine'
import { unitForCategory } from '../domain/productUnits'
import { deleteProduct, saveProduct, saveRoute } from '../data/distributionRepository'
import { prepareProductPhoto } from '../data/productPhoto'
import { SAN_JOSE_PRODUCTS, SAN_JOSE_ROUTES } from '../seed/sanJoseSeed'
import { PrimaryButton, SecondaryButton, formatBs, formatQty } from './shared'
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
  const [cost, setCost] = useState('0')
  const [minimum, setMinimum] = useState('0')
  const [photoDataUrl, setPhotoDataUrl] = useState('')
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false)
  const [active, setActive] = useState(true)
  const [isSeeding, setIsSeeding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DistProduct | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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
    setCost('0'); setMinimum('0')
    setPhotoDataUrl('')
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
    setCost(String(product.productionCost || 0)); setMinimum(String(product.minimumStock || 0))
    setPhotoDataUrl(product.photoDataUrl || '')
    setWeight(product.approximateWeightKg ? String(product.approximateWeightKg) : '')
    setActive(product.active !== false)
    setError(null)
    setIsOpen(true)
  }

  const changeCategory = (nextCategory: string) => {
    const categoryUnit = unitForCategory(nextCategory)
    if (editing && categoryUnit && categoryUnit !== editing.unitType) {
      setError('La unidad de un producto existente no se puede cambiar porque afectaría su inventario e historial. Crea otro producto para esta presentación.')
      return
    }
    setCategory(nextCategory)
    if (!editing && categoryUnit) setUnitType(categoryUnit)
    setError(null)
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

    if ([price, cost, minimum].some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) { setError('Precio, costo y mínimo deben ser números positivos o cero.'); return }
    try {
    await saveProduct({
      id,
      name: name.trim(),
      photoDataUrl,
      category,
      presentation: presentation.trim(),
      unitType,
      referencePrice: round2(Number(price)),
      productionCost: round2(Number(cost)), minimumStock: round2(Number(minimum)),
      approximateWeightKg: weight ? round2(Number(weight)) : undefined,
      active,
      sortOrder: editing?.sortOrder ?? data.products.length,
      createdAt: editing?.createdAt,
    })
    setIsOpen(false)
    } catch (err) { setError((err as Error).message) }
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
        <div className="flex items-center gap-2">
          <button type="button" aria-label={deleteMode ? 'Salir de eliminar productos' : 'Eliminar productos'} onClick={() => setDeleteMode(value => !value)} className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${deleteMode ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600'}`}><Pencil size={17} /></button>
          <PrimaryButton onClick={openCreate}><Plus size={16} /> Nuevo</PrimaryButton>
        </div>
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

        {deleteMode && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Toca un producto para eliminarlo. Solo se permite si no tiene existencias ni despachos abiertos.</p>}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => {
            const stock = data.balances.find(balance => balance.locationKind === 'central' && (balance.warehouseId || 'central') === 'central' && balance.productId === product.id)?.availableQuantity ?? 0
            return (
            <button
              key={product.id}
              type="button"
              onClick={() => deleteMode ? setDeleteTarget(product) : openEdit(product)}
              className={`relative flex min-h-[112px] w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition active:scale-[0.99] ${deleteMode ? 'border-rose-300' : 'border-slate-200'}`}
            >
              {deleteMode && <span className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 text-white shadow"><Trash2 size={15} /></span>}
              {product.photoDataUrl && <img src={product.photoDataUrl} alt={`Foto de ${product.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} className="aspect-[16/9] w-full object-cover" />}
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-3">
                <p className="text-xs font-extrabold leading-snug text-slate-900">{product.name}</p>
                <div className="flex flex-wrap items-end justify-between gap-1.5">
                  <span className="text-[10px] font-semibold text-slate-500">{formatQty(stock, product.unitType)} disponibles</span>
                  <span className="text-sm font-black tabular-nums" style={{ color: 'var(--primary)' }}>{formatBs(product.referencePrice)}</span>
                </div>
              </div>
            </button>
            )
          })}
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
          <Field label="Fotografía del producto" hint="Opcional. Se recorta de forma proporcional en el catálogo.">
            <div className="grid gap-2">
              {photoDataUrl && <img src={photoDataUrl} alt="Vista previa del producto" onError={(event) => { event.currentTarget.style.display = 'none' }} className="aspect-[16/9] w-full rounded-2xl border border-slate-200 object-cover" />}
              <div className="grid grid-cols-2 gap-2">
                <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700">
                  <ImagePlus size={16} /> {isPreparingPhoto ? 'Procesando...' : photoDataUrl ? 'Cambiar foto' : 'Agregar foto'}
                  <input type="file" accept="image/*" className="sr-only" disabled={isPreparingPhoto} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setIsPreparingPhoto(true); setError(null); try { setPhotoDataUrl(await prepareProductPhoto(file)) } catch (photoError) { setError((photoError as Error).message) } finally { setIsPreparingPhoto(false); event.target.value = '' } }} />
                </label>
                <button type="button" disabled={!photoDataUrl} onClick={() => setPhotoDataUrl('')} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 text-xs font-extrabold text-slate-600 disabled:opacity-40"><Trash2 size={15} /> Quitar</button>
              </div>
            </div>
          </Field>
          <Field label={`Costo de producción por ${unitType === 'kg' ? 'kg' : unitType === 'package' ? 'paquete' : 'unidad'} (Bs)`} hint="Ingresa el costo de producir una sola unidad de venta, no el costo de todo un lote."><NumberInput min={0} step={0.01} value={cost} onChange={event => setCost(event.target.value)} /></Field>
          <Field label={`Existencia mínima (${unitType === 'kg' ? 'kg' : unitType === 'package' ? 'paquetes' : 'unidades'})`}><NumberInput min={0} value={minimum} onChange={event => setMinimum(event.target.value)} /></Field>
          <Field label="Nombre" required>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Categoria / presentacion comercial">
            <Segmented value={category} onChange={changeCategory} options={[{ value: 'Al vacio', label: 'Al vacío' }, { value: 'Granel', label: 'Granel' }, { value: 'Otros', label: 'Otros' }]} />
          </Field>
          <Field label="Detalle de presentacion" hint="Ej: sachet 200 g, 10 unidades 12 cm">
            <TextInput value={presentation} onChange={(event) => setPresentation(event.target.value)} />
          </Field>
          <Field label="Unidad de venta" hint={editing ? 'La unidad de un producto existente no cambia para proteger su inventario e historial.' : unitForCategory(category) ? 'Se eligió automáticamente según la categoría.' : 'Elige cómo se contará y venderá este producto. Los reportes no convierten paquetes a kilos.'}>
            {editing || unitForCategory(category) ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-bold text-slate-700">{unitType === 'kg' ? 'Granel (kg)' : unitType === 'package' ? 'Paquete / sachet' : 'Unidad'}</div> : <Segmented value={unitType} onChange={setUnitType} options={[{ value: 'kg', label: 'Granel (kg)' }, { value: 'package', label: 'Paquete' }, { value: 'unit', label: 'Unidad' }]} />}
          </Field>
          <Field label="Precio de referencia (Bs)" hint="Solo Administración puede modificar el precio de venta.">
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
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar producto" subtitle={deleteTarget?.name} footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={isDeleting} onClick={() => setDeleteTarget(null)}>Cancelar</SecondaryButton><button type="button" disabled={isDeleting} onClick={async () => { if (!deleteTarget) return; setIsDeleting(true); setError(null); try { await deleteProduct(deleteTarget.id); setDeleteTarget(null) } catch (e) { setError((e as Error).message) } finally { setIsDeleting(false) } }} className="min-h-[44px] rounded-2xl bg-rose-600 px-3 text-sm font-extrabold text-white disabled:opacity-50">{isDeleting ? 'Eliminando...' : 'Sí, eliminar'}</button></div>}><p className="text-sm text-slate-700">El producto dejará de aparecer en ventas, inventario y selectores. Sus ventas anteriores conservarán el detalle histórico.</p>{error && <p className="mt-3 text-xs font-bold text-rose-600">{error}</p>}</Modal>
    </Screen>
  )
}

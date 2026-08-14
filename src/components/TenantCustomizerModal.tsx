import { useState } from 'react'
import { X, Sparkles, Printer, Palette, Store, Save, Building2 } from 'lucide-react'
import { updateRestaurantProfile } from '../lib/firebase'
import { getBusinessTypeDefinition } from '../config/businessTypes'
import type { BusinessType, RestaurantBranding } from '../types'

interface TenantCustomizerModalProps {
  isOpen: boolean
  onClose: () => void
  initialBranding: RestaurantBranding
  onSave: (branding: Partial<RestaurantBranding>) => Promise<void>
  /** Necesario para cambiar el tipo de empresa del tenant */
  restaurantId?: string | null
  businessType?: BusinessType
}

export function TenantCustomizerModal({
  isOpen,
  onClose,
  initialBranding,
  onSave,
  restaurantId,
  businessType = 'restaurant',
}: TenantCustomizerModalProps) {
  const [name, setName] = useState(initialBranding.name || '')
  const [logoUrl, setLogoUrl] = useState(initialBranding.logoUrl || '')
  const [accentColor, setAccentColor] = useState(initialBranding.accentColor || '#00F0FF')
  const [primaryColor, setPrimaryColor] = useState(initialBranding.primaryColor || '#0B132B')
  const [receiptHeader, setReceiptHeader] = useState(initialBranding.receiptHeader || '')
  const [receiptFooter, setReceiptFooter] = useState(initialBranding.receiptFooter || '')
  const [tablesCount, setTablesCount] = useState(initialBranding.tablesCount || 12)
  const [isSaving, setIsSaving] = useState(false)
  const [selectedBusinessType, setSelectedBusinessType] = useState<BusinessType>(businessType)
  const [isSwitching, setIsSwitching] = useState(false)

  if (!isOpen) return null

  // El tipo de empresa define modulos, roles y tema. Cambiarlo recarga la app
  // para que se monte el shell correcto.
  const applyBusinessType = async () => {
    if (!restaurantId || selectedBusinessType === businessType) return
    setIsSwitching(true)
    try {
      const definition = getBusinessTypeDefinition(selectedBusinessType)
      await updateRestaurantProfile(restaurantId, {
        businessType: selectedBusinessType,
        currencyCode: definition.defaultCurrencyCode,
        currencySymbol: definition.defaultCurrencySymbol,
        branding: {
          ...initialBranding,
          name,
          primaryColor: definition.theme.primary,
          accentColor: definition.theme.accent,
          surfaceColor: definition.theme.background,
        },
      })
      window.location.reload()
    } finally {
      setIsSwitching(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await onSave({
        name,
        logoUrl,
        accentColor,
        primaryColor,
        receiptHeader,
        receiptFooter,
        tablesCount: Number(tablesCount),
      })
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-pachaxDark/80 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-3xl glass-panel border border-pachaxCyan/30 p-6 shadow-float cyan-border-glow">
        <div className="flex items-center justify-between pb-4 border-b border-panelBorder">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-pachaxNavy flex items-center justify-center text-pachaxCyan cyan-glow">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-ink">Personalizar Mi Restaurante</h2>
              <p className="text-xs text-muted">Ajusta los colores, logo y tickets de tu negocio</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-xl bg-pachaxNavy hover:bg-pachaxNavyLight text-muted hover:text-ink flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* Tipo de empresa: decide modulos, roles y experiencia del tenant */}
          {restaurantId && (
            <div className="rounded-2xl border border-panelBorder bg-white p-3">
              <label className="mb-1.5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-muted">
                <Building2 size={14} /> Tipo de empresa
              </label>
              <select
                value={selectedBusinessType}
                onChange={(event) => setSelectedBusinessType(event.target.value as BusinessType)}
                className="min-h-[44px] w-full rounded-2xl border border-panelBorder px-3 text-sm font-bold"
              >
                <option value="restaurant">Restaurante / gastronomia</option>
                <option value="mobile_distribution">Distribucion movil (rutas y distribuidores)</option>
              </select>
              {selectedBusinessType !== businessType && (
                <button
                  type="button"
                  onClick={() => void applyBusinessType()}
                  disabled={isSwitching}
                  className="mt-2 min-h-[44px] w-full rounded-2xl bg-blue-600 px-4 text-xs font-extrabold text-white disabled:opacity-50"
                >
                  {isSwitching ? 'Aplicando...' : 'Aplicar tipo de empresa y recargar'}
                </button>
              )}
            </div>
          )}
          {/* Identity & Logo */}
          <div className="space-y-3 p-4 rounded-2xl bg-pachaxNavy/40 border border-panelBorder">
            <div className="text-xs font-bold text-pachaxCyan uppercase tracking-wider flex items-center gap-1.5">
              <Store size={14} /> Identidad Comercial
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Nombre del Restaurante</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-sm focus:border-pachaxCyan focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">URL del Logo (opcional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-sm focus:border-pachaxCyan focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Theme Colors */}
          <div className="space-y-3 p-4 rounded-2xl bg-pachaxNavy/40 border border-panelBorder">
            <div className="text-xs font-bold text-pachaxCyan uppercase tracking-wider flex items-center gap-1.5">
              <Palette size={14} /> Colores de Marca
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Color Principal</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 rounded-lg bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-xs font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Color de Acento (Neón/Botones)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-9 w-12 rounded-lg bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Table Count & Ticket Settings */}
          <div className="space-y-3 p-4 rounded-2xl bg-pachaxNavy/40 border border-panelBorder">
            <div className="text-xs font-bold text-pachaxCyan uppercase tracking-wider flex items-center gap-1.5">
              <Printer size={14} /> Mesas y Tickets de Impresión
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Número Total de Mesas</label>
              <input
                type="number"
                min={1}
                max={100}
                value={tablesCount}
                onChange={(e) => setTablesCount(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-sm focus:border-pachaxCyan focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Encabezado del Ticket</label>
              <input
                type="text"
                value={receiptHeader}
                onChange={(e) => setReceiptHeader(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-sm focus:border-pachaxCyan focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pie del Ticket</label>
              <input
                type="text"
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-pachaxDark border border-panelBorder text-ink text-sm focus:border-pachaxCyan focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-pachaxNavy text-muted hover:text-ink text-xs font-bold transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-pachaxCyanDark to-pachaxCyan text-pachaxDark text-xs font-extrabold shadow-card cyan-glow transition hover:opacity-95"
            >
              <Save size={16} /> {isSaving ? 'Guardando...' : 'Guardar Ajustes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

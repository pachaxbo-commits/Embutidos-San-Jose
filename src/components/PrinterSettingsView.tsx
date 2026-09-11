import { getFirebaseRestaurantId } from '../lib/firebase'
import { useState, useEffect } from 'react'
import {
  Printer,
  Plus,
  Edit2,
  X,
  Wifi,
  Bluetooth,
  ShieldCheck,
  Info,
  Play,
} from 'lucide-react'
import { PrintEngineService } from '../services/printing/printEngineService'
import { PrintMigrationService, type PrintingEngineVersion } from '../services/printing/printMigrationService'
import { AndroidNetworkTcpPrinterAdapter } from '../adapters/printing/androidNetworkTcpPrinterAdapter'
import { AndroidBluetoothSppAdapter } from '../adapters/printing/androidBluetoothSppAdapter'
import { savePrinterProfile } from '../services/printing/printerBootstrap'
import { PageHeader } from './ui/PageHeader'
import type { PrinterProfile, PrinterConnectionType } from '../types/printing'

interface PrinterSettingsViewProps {
  onBack?: () => void
}

export function PrinterSettingsView({ onBack }: PrinterSettingsViewProps) {
  const engine = PrintEngineService.getInstance()
  const migration = PrintMigrationService.getInstance()

  const [engineVersion, setEngineVersion] = useState<PrintingEngineVersion>(migration.getEngineVersion())
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Partial<PrinterProfile> | null>(null)

  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    loadProfiles()
  }, [])

  const loadProfiles = () => {
    const activeProfiles = engine.listPrinterProfiles()
    setProfiles(activeProfiles)
  }

  const handleToggleEngineVersion = (version: PrintingEngineVersion) => {
    migration.setEngineVersion(version)
    setEngineVersion(version)
    setStatusMessage(`Motor de impresión cambiado a: ${version === 'new' ? 'NUEVO MOTOR (PrintEngineService)' : 'MODO LEGACY'}`)
  }

  const handleOpenCreateModal = () => {
    setEditingProfile({
      id: `prn-${Date.now()}`,
      restaurantId: getFirebaseRestaurantId(),
      branchId: 'main',
      name: 'Nueva Impresora',
      role: 'receipt',
      connectionType: 'network_tcp',
      paperWidth: '80mm',
      ipAddress: '192.168.1.150',
      port: 9100,
      copies: 1,
      autoPrintOnOrderCreated: true,
      autoPrintOnOrderPaid: true,
      kickDrawerOnPrint: true,
      isActive: true,
      capabilities: {
        supportsCashDrawerKick: true,
        supportsPaperCut: true,
        supportsBeep: true,
        supportsBarcode: true,
        supportsQrCode: true,
        supportsImages: true,
        supportsRealtimeStatus: false,
        columnsPerLine: 48,
        codePage: 'CP850',
        encoding: 'utf-8',
        chunkSize: 1024,
        chunkDelayMs: 10,
        connectionTimeoutMs: 5000,
        writeTimeoutMs: 5000,
        feedLinesEnd: 3,
      },
    })
    setIsEditingModalOpen(true)
  }

  const handleOpenEditModal = (profile: PrinterProfile) => {
    setEditingProfile({ ...profile })
    setIsEditingModalOpen(true)
  }

  const handleSaveProfile = () => {
    if (!editingProfile || !editingProfile.name) return
    // Se persiste ademas de registrarse: antes el perfil se perdia al recargar.
    savePrinterProfile(editingProfile as PrinterProfile)
    loadProfiles()
    setIsEditingModalOpen(false)
    setStatusMessage(`Perfil de impresora "${editingProfile.name}" guardado exitosamente.`)
  }

  const handleToggleActive = (profile: PrinterProfile) => {
    const updated = { ...profile, isActive: !profile.isActive }
    savePrinterProfile(updated)
    loadProfiles()
  }

  const handleTestConnection = async () => {
    if (!editingProfile) return
    setIsTesting(true)
    setTestResult(null)

    if (editingProfile.connectionType === 'network_tcp') {
      const tcpAdapter = new AndroidNetworkTcpPrinterAdapter()
      const res = await tcpAdapter.testConnection(
        editingProfile.ipAddress || '',
        editingProfile.port || 9100,
        editingProfile.capabilities?.connectionTimeoutMs || 5000
      )
      setIsTesting(false)
      if (res.connected) {
        setTestResult('🟢 CONEXIÓN TCP EXITOSA')
      } else {
        setTestResult(`🔴 FALLÓ: ${res.message}`)
      }
    } else {
      const sppAdapter = new AndroidBluetoothSppAdapter()
      const isAvailable = sppAdapter.isPluginAvailable()
      setIsTesting(false)
      if (isAvailable) {
        setTestResult('🟢 PLUGIN BLUETOOTH DETECTADO Y ENLACE LISTO')
      } else {
        setTestResult('🔴 PLUGIN BLUETOOTH NO DISPONIBLE EN EL NAVEGADOR')
      }
    }
  }

  return (
    <div className="space-y-4 bg-slate-50 min-h-screen pb-12">
      <PageHeader
        title="Impresoras y Estaciones"
        subtitle="Gestión de impresoras térmicas Bluetooth SPP y Red LAN TCP/IP"
        onBack={onBack}
        actions={
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus size={16} /> Agregar Impresora
          </button>
        }
      />

      <div className="max-w-7xl mx-auto px-4 space-y-4">
        {/* Top Banner & Migration Flag */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Printer size={20} />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Motor de Impresión PACHAX</h2>
              <p className="text-xs text-slate-500 font-medium">Selecciona el modo de servicio de impresión</p>
            </div>
          </div>

          {/* Feature Flag Switch */}
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            <button
              onClick={() => handleToggleEngineVersion('new')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                engineVersion === 'new' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <ShieldCheck size={14} /> Nuevo Motor PACHAX
            </button>
            <button
              onClick={() => handleToggleEngineVersion('legacy')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                engineVersion === 'legacy' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Modo Legacy
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center gap-2">
            <Info size={16} className="text-blue-600 shrink-0" />
            {statusMessage}
          </div>
        )}

      {/* Printer List Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Perfiles de Impresora Registrados ({profiles.length})</h2>
        <button
          onClick={handleOpenCreateModal}
          className="px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-blue-500/20 transition"
        >
          <Plus size={16} /> Crear Perfil de Impresora
        </button>
      </div>

      {/* Profiles Grid */}
      {profiles.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-3">
          <Printer size={36} className="mx-auto text-slate-300" />
          <h3 className="font-bold text-slate-700 text-sm">No hay impresoras registradas</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Crea tu primera impresora para enrutar recibos de caja y comandas de cocina.
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition"
          >
            Agregar Impresora
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((p) => (
            <div key={p.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3 relative">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-2xl ${p.connectionType === 'network_tcp' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {p.connectionType === 'network_tcp' ? <Wifi size={20} /> : <Bluetooth size={20} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">{p.name}</h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Rol: <span className="font-semibold text-slate-600 uppercase">{p.role}</span> | Papel: {p.paperWidth}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleToggleActive(p)}
                  className={`px-3 py-1 rounded-full text-[10px] font-extrabold transition ${
                    p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {p.isActive ? 'ACTIVA' : 'INACTIVA'}
                </button>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl text-xs space-y-1 font-mono text-slate-600">
                {p.connectionType === 'network_tcp' ? (
                  <div>IP: <strong>{p.ipAddress || '192.168.1.150'}</strong>:{p.port || 9100}</div>
                ) : (
                  <div>MAC: <strong>{p.macAddress || 'Dispositivo Emparejado'}</strong></div>
                )}
                <div>Auto-Recibo: {p.autoPrintOnOrderPaid ? 'SÍ' : 'NO'} | Gaveta: {p.kickDrawerOnPrint ? 'SÍ' : 'NO'}</div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                <button
                  onClick={() => handleOpenEditModal(p)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center gap-1 transition"
                >
                  <Edit2 size={13} /> Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Create Modal */}
      {isEditingModalOpen && editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-xl w-full space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-base">
                {editingProfile.id ? 'Editar Perfil de Impresora' : 'Crear Perfil de Impresora'}
              </h3>
              <button onClick={() => setIsEditingModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            {testResult && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono font-semibold">
                {testResult}
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nombre de la Impresora:</label>
                <input
                  type="text"
                  value={editingProfile.name || ''}
                  onChange={(e) => setEditingProfile((p) => ({ ...p, name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Tipo de Conexión:</label>
                  <select
                    value={editingProfile.connectionType}
                    onChange={(e) => setEditingProfile((p) => ({ ...p, connectionType: e.target.value as PrinterConnectionType }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 text-slate-800 font-semibold focus:outline-none"
                  >
                    <option value="network_tcp">Red LAN / IP (TCP 9100)</option>
                    <option value="bluetooth_spp">Bluetooth Classic SPP</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Rol / Propósito:</label>
                  <select
                    value={editingProfile.role}
                    onChange={(e) => setEditingProfile((p) => ({ ...p, role: e.target.value as any }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 text-slate-800 font-semibold focus:outline-none"
                  >
                    <option value="receipt">Recibo de Caja</option>
                    <option value="kitchen">Comanda Cocina</option>
                    <option value="bar">Bar / Despacho</option>
                  </select>
                </div>
              </div>

              {editingProfile.connectionType === 'network_tcp' ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="font-bold text-slate-700 block mb-1">Dirección IP / Host:</label>
                    <input
                      type="text"
                      value={editingProfile.ipAddress || ''}
                      onChange={(e) => setEditingProfile((p) => ({ ...p, ipAddress: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-mono font-semibold"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Puerto TCP:</label>
                    <input
                      type="number"
                      value={editingProfile.port || 9100}
                      onChange={(e) => setEditingProfile((p) => ({ ...p, port: Number(e.target.value) }))}
                      className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-mono font-semibold"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Dirección MAC Bluetooth:</label>
                  <input
                    type="text"
                    value={editingProfile.macAddress || ''}
                    onChange={(e) => setEditingProfile((p) => ({ ...p, macAddress: e.target.value }))}
                    placeholder="00:11:22:33:44:55"
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-mono font-semibold"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Ancho de Papel:</label>
                  <select
                    value={editingProfile.paperWidth}
                    onChange={(e) => setEditingProfile((p) => ({ ...p, paperWidth: e.target.value as '58mm' | '80mm' }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 text-slate-800 font-semibold"
                  >
                    <option value="80mm">80 mm (Estándar)</option>
                    <option value="58mm">58 mm (Compacto)</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 py-2.5">
                    <input
                      type="checkbox"
                      checked={editingProfile.kickDrawerOnPrint || false}
                      onChange={(e) => setEditingProfile((p) => ({ ...p, kickDrawerOnPrint: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                    />
                    Abrir Gaveta al Imprimir
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 hover:bg-slate-50 transition"
              >
                <Play size={14} /> {isTesting ? 'Probando...' : 'Probar Conexión'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditingModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20"
                >
                  Guardar Perfil
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

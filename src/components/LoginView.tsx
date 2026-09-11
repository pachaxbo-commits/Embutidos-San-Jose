import { useState } from 'react'
import { LoaderCircle, LogIn, ShieldCheck } from 'lucide-react'

export function LoginView({
  error,
  isLoading,
  onSubmit,
}: {
  error: string | null
  isLoading: boolean
  onSubmit: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="relative flex min-h-[100dvh] w-full overflow-hidden flex-col items-center justify-center bg-[#FAF7F2] px-4 py-6 text-slate-900 font-sans selection:bg-red-500/20 selection:text-red-700 ">
      {/* Background Soft Glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-400/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative w-full max-w-sm rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl backdrop-blur-md transition-all">
        {/* Header con Título Elegante */}
        <div className="text-center mb-6">
          <img
            src="/brand/san-jose-logo.png"
            alt="Logo de Embutidos San José"
            className="brand-float mx-auto mb-3 h-auto w-48 max-w-[75%] object-contain"
          />
          <h1 className="text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-red-700 via-red-800 to-slate-900 drop-shadow-sm select-none py-1">
            Embutidos San José
          </h1>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            await onSubmit(email, password)
          }}
        >
          <div>
            <label htmlFor="login-email" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Correo Electrónico
            </label>
            <input
              required
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-red-600 focus:bg-white focus:ring-2 focus:ring-red-600/20"
              placeholder="tu.correo@empresa.com"
              id="login-email"
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Contraseña
            </label>
            <input
              required
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-red-600 focus:bg-white focus:ring-2 focus:ring-red-600/20"
              placeholder="••••••••"
              id="login-password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600 text-center">
              {error}
            </div>
          ) : null}

          <button
            disabled={isLoading || !email || !password}
            type="submit"
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-red-500/25 hover:from-red-700 hover:to-red-600 transition disabled:opacity-50 mt-2"
          >
            {isLoading ? <LoaderCircle size={18} className="animate-spin" /> : <LogIn size={18} />}
            {isLoading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck size={14} className="text-red-600" /> Gestión y distribución
        </div>
      </div>
    </div>
  )
}

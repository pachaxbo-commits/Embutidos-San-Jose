import { LockKeyhole, LogOut } from 'lucide-react'
import { Button } from './ui/Button'
import { Panel } from './ui/Panel'

export function UnauthorizedView({
  email,
  message,
  onSignOut,
}: {
  email: string | null
  message: string
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-ink">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.8),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(197,91,51,0.08),_transparent_25%)]" />
      <Panel className="relative w-full max-w-xl border-white/85 bg-white/88 p-7">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#fff3ec] text-[#9c4d2a] shadow-lg">
          <LockKeyhole size={24} />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.28em] text-accent">Acceso no autorizado</p>
        <h1 className="mt-2 font-serif text-4xl text-ink">Acceso a Embutidos San José</h1>
        <p className="mt-3 text-sm leading-7 text-muted">{message}</p>
        {email ? <div className="mt-5 rounded-[1.2rem] border border-line bg-panel/85 px-4 py-3 text-sm text-muted">Usuario actual: {email}</div> : null}
        <div className="mt-6">
          <Button onClick={onSignOut}>
            <LogOut size={18} />
            Cerrar sesion
          </Button>
        </div>
      </Panel>
    </div>
  )
}

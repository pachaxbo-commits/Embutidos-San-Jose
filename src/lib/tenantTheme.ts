import type { BusinessTypeTheme } from '../config/businessTypes'

/**
 * Aplica el tema del tenant sobre las variables CSS de la aplicacion.
 * El tema siempre es claro: solo cambian marca, acento y fondo base.
 */
export function applyTenantTheme(theme: BusinessTypeTheme, overrides?: { primary?: string; accent?: string }) {
  const root = document.documentElement
  const primary = overrides?.primary || theme.primary
  const accent = overrides?.accent || theme.accent

  root.style.setProperty('--primary', primary)
  root.style.setProperty('--primary-hover', theme.primaryHover)
  root.style.setProperty('--primary-soft', theme.primarySoft)
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-soft', theme.accentSoft)
  root.style.setProperty('--background', theme.background)
  root.style.setProperty('--surface', theme.surface)
  document.body.style.backgroundColor = theme.background
}

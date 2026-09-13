import type { AppTheme } from '../config/appConfig'

export function applyAppTheme(theme: AppTheme) {
  const root = document.documentElement
  root.style.setProperty('--primary', theme.primary)
  root.style.setProperty('--primary-hover', theme.primaryHover)
  root.style.setProperty('--primary-soft', theme.primarySoft)
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-soft', theme.accentSoft)
  root.style.setProperty('--background', theme.background)
  root.style.setProperty('--surface', theme.surface)
  document.body.style.backgroundColor = theme.background
}

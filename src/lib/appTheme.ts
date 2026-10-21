import type { AppTheme } from '../config/appConfig'

export type AppThemeMode = 'light' | 'dark'
export const APP_THEME_STORAGE_KEY = 'san-jose:theme:v1'

export function getSavedAppTheme(): AppThemeMode {
  try {
    return localStorage.getItem(APP_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function saveAppTheme(mode: AppThemeMode) {
  try { localStorage.setItem(APP_THEME_STORAGE_KEY, mode) } catch { /* preference is optional */ }
}

export function applyAppTheme(theme: AppTheme, mode: AppThemeMode = 'light') {
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.colorScheme = mode
  root.style.setProperty('--primary', theme.primary)
  root.style.setProperty('--primary-hover', theme.primaryHover)
  root.style.setProperty('--primary-soft', mode === 'dark' ? '#4A2930' : theme.primarySoft)
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-soft', mode === 'dark' ? '#4B4225' : theme.accentSoft)
  root.style.setProperty('--background', mode === 'dark' ? '#202630' : theme.background)
  root.style.setProperty('--surface', mode === 'dark' ? '#303946' : theme.surface)
  root.style.setProperty('--surface-secondary', mode === 'dark' ? '#414D5C' : (theme.surfaceSecondary || '#F1F4F7'))
  root.style.setProperty('--border', mode === 'dark' ? '#566273' : (theme.border || '#D4DCE5'))
  root.style.setProperty('--text-primary', mode === 'dark' ? '#F8FAFC' : (theme.textPrimary || '#172033'))
  root.style.setProperty('--text-secondary', mode === 'dark' ? '#CBD5E1' : (theme.textSecondary || '#475569'))
  root.style.setProperty('--text-muted', mode === 'dark' ? '#AAB7C7' : (theme.textMuted || '#64748B'))
  document.body.style.backgroundColor = 'var(--background)'
}

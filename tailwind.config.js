/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        surfaceSecondary: 'var(--surface-secondary)',
        border: 'var(--border)',
        textPrimary: 'var(--text-primary)',
        textSecondary: 'var(--text-secondary)',
        textMuted: 'var(--text-muted)',

        primary: 'var(--primary)',
        primaryHover: 'var(--primary-hover)',
        primarySoft: 'var(--primary-soft)',

        accent: 'var(--accent)',
        accentSoft: 'var(--accent-soft)',

        success: 'var(--success)',
        successSoft: 'var(--success-soft)',
        warning: 'var(--warning)',
        warningSoft: 'var(--warning-soft)',
        danger: 'var(--danger)',
        dangerSoft: 'var(--danger-soft)',

        // Legacy compatibility aliases mapped to light theme tokens
        canvas: 'var(--background)',
        panel: 'var(--surface)',
        panelLight: 'var(--surface-secondary)',
        panelBorder: 'var(--border)',
        ink: 'var(--text-primary)',
        muted: 'var(--text-secondary)',
        mutedDark: 'var(--text-muted)',
        line: 'var(--border)',
        lineStrong: 'var(--border)',
        pachaxDark: '#171E28',
        pachaxNavy: '#1E293B',
        pachaxNavyLight: '#334155',
        pachaxCyan: '#0EA5A8',
        pachaxCyanDark: '#0D9488',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        card: '0 2px 8px 0 rgba(15, 23, 42, 0.06), 0 0 0 1px #DCE3EC',
        modal: '0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.05)',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}

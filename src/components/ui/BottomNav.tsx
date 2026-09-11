import type { ComponentType } from 'react'

export interface BottomNavItem<T extends string> {
  id: T
  label: string
  icon: ComponentType<{ size?: number | string }>
  badge?: number
}

/**
 * Navegacion inferior movil generica, alimentada por datos.
 *
 * A diferencia de la barra especifica del comandero, no conoce ninguna vista:
 * cualquier tipo de empresa le pasa sus modulos visibles. Respeta safe-area y
 * mantiene objetivos tactiles de ~44px.
 */
export function BottomNav<T extends string>({
  items,
  currentId,
  onSelect,
}: {
  items: BottomNavItem<T>[]
  currentId: T
  onSelect: (id: T) => void
}) {
  if (items.length === 0) return null

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around border-t border-slate-200 bg-white px-1 md:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      {items.map((item) => {
        const Icon = item.icon
        const isActive = item.id === currentId
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className="relative flex min-h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5"
            style={{ color: isActive ? 'var(--primary)' : '#64748B' }}
          >
            <span className="relative">
              <Icon size={20} />
              {item.badge != null && item.badge > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-black text-white">
                  {item.badge}
                </span>
              )}
            </span>
            <span className={`w-full text-center text-[9px] leading-tight ${isActive ? 'font-extrabold' : 'font-semibold'}`}>
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

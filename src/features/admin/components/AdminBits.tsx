import type { ReactNode } from 'react'
import { Eye, ShieldCheck } from 'lucide-react'
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '@/config/permissions'
import { useCan } from '@/hooks/useAuth'
import { Badge, StatusDot, type Tone } from '@/components/ui/display'
import { Tooltip } from '@/components/ui/overlays'
import { cn } from '@/lib/utils'
import type { Role, User } from '@/types'
import { ACTION_LABEL, ACTION_SHORT } from '../lib/access'

/** Create / edit / delete / export capabilities for the Administration module. */
export function useAdminCaps() {
  return {
    create: useCan('admin.create'),
    edit: useCan('admin.edit'),
    del: useCan('admin.delete'),
    exportCsv: useCan('admin.export'),
  }
}

export function ReadOnlyNotice({ what = 'administration settings' }: { what?: string }) {
  return (
    <div role="note" className="mb-4 flex items-center gap-2 rounded-lg border border-info/25 bg-info/8 px-3 py-2 text-xs text-info">
      <Eye className="size-4 shrink-0" />
      <span>
        <span className="font-medium">View-only access.</span> Your role can view {what} but not change them. Ask a Super Administrator for the Administration · Edit permission.
      </span>
    </div>
  )
}

export const USER_STATUS: Record<User['status'], { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  invited: { label: 'Invited', tone: 'info' },
  disabled: { label: 'Disabled', tone: 'neutral' },
}

export function UserStatusBadge({ status }: { status: User['status'] }) {
  const m = USER_STATUS[status]
  return (
    <Badge tone={m.tone} className="gap-1.5">
      <StatusDot tone={m.tone} className="size-1.5 [&>span]:size-1.5" />
      {m.label}
    </Badge>
  )
}

export function roleTone(role: Pick<Role, 'id' | 'builtIn'> | undefined): Tone {
  if (!role) return 'neutral'
  if (role.id === 'role-super') return 'primary'
  return role.builtIn ? 'info' : 'outline'
}

export function RoleBadge({ role, className }: { role: Role | undefined; className?: string }) {
  if (!role) return <span className="text-subtle-foreground">—</span>
  return (
    <Badge tone={roleTone(role)} className={cn('gap-1', className)}>
      {role.id === 'role-super' && <ShieldCheck />}
      {role.name}
    </Badge>
  )
}

/** Compact row of six permission pips (V C E D A X) for one module. */
export function PermissionPips({ granted, className }: { granted: Set<string>; className?: string; module?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {PERMISSION_ACTIONS.map((a) => {
        const on = granted.has(a)
        return (
          <Tooltip key={a} content={`${ACTION_LABEL[a]}${on ? '' : ' — not granted'}`}>
            <span
              className={cn(
                'inline-flex size-[18px] items-center justify-center rounded-[4px] text-[10px] font-semibold',
                on ? 'bg-primary/15 text-primary' : 'bg-surface-3 text-subtle-foreground/70',
              )}
            >
              {ACTION_SHORT[a]}
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}

/** Module-by-module permission summary for a permission set. */
export function PermissionSummary({ permissions, className }: { permissions: string[]; className?: string }) {
  const set = new Set(permissions)
  return (
    <div className={cn('divide-y divide-border/70 rounded-lg border border-border', className)}>
      {PERMISSION_MODULES.map((m) => {
        const granted = new Set(PERMISSION_ACTIONS.filter((a) => set.has(`${m.key}.${a}`)))
        return (
          <div key={m.key} className={cn('flex items-center justify-between gap-3 px-3 py-1.5', granted.size === 0 && 'opacity-60')}>
            <span className="truncate text-[13px]">{m.label}</span>
            <PermissionPips granted={granted} />
          </div>
        )
      })}
    </div>
  )
}

/** Small label + value pair used in dense summaries. */
export function MiniStat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="min-w-0">
      <div className="label-xs">{label}</div>
      <div className={cn('num text-[15px] font-semibold leading-tight', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger')}>{value}</div>
      {hint && <div className="truncate text-[11px] text-subtle-foreground">{hint}</div>}
    </div>
  )
}

/** Inline code-ish chip. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground', className)}>{children}</span>
}

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, BellOff, Check, CheckCheck, CircleAlert, Info, ShieldAlert, Trash2, TriangleAlert, X, CircleCheck } from 'lucide-react'
import type { AppNotification, Severity } from '@/types'
import { useNotifications } from '@/store/notifications'
import { useUi } from '@/store/ui'
import { navigateTo, openEntity } from '@/lib/navigation'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlays'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/shared/EmptyState'
import { useEntityLabel } from '@/components/shared/EntityLink'

const SEV_ICON: Record<Severity, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  critical: { icon: ShieldAlert, cls: 'bg-danger/15 text-danger' },
  warning: { icon: TriangleAlert, cls: 'bg-warning/15 text-warning' },
  success: { icon: CircleCheck, cls: 'bg-success/15 text-success' },
  info: { icon: Info, cls: 'bg-info/15 text-info' },
}

function EntityChip({ n }: { n: AppNotification }) {
  const label = useEntityLabel(n.entity?.type ?? 'vehicle', n.entity?.id)
  if (!n.entity || !label) return null
  return <span className="rounded border border-border bg-surface-3 px-1 py-px font-mono text-[10.5px] text-muted-foreground">{label}</span>
}

function Item({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  const { markRead, markUnread, remove } = useNotifications()
  const sev = SEV_ICON[n.severity]
  const Icon = sev.icon
  return (
    <motion.li initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }} transition={{ duration: 0.2 }} className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => { markRead(n.id); onOpen() }}
        onKeyDown={(e) => { if (e.key === 'Enter') { markRead(n.id); onOpen() } }}
        className={cn('flex w-full cursor-pointer gap-2.5 border-b border-border/60 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50', !n.read && 'bg-primary/[0.04]')}
      >
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', sev.cls)}><Icon className="size-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className={cn('text-[13px] leading-snug', n.read ? 'font-normal text-muted-foreground' : 'font-medium text-foreground')}>{n.title}</span>
            {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.message}</span>
          <span className="mt-1.5 flex items-center gap-2 text-[11px] text-subtle-foreground">
            <span>{timeAgo(n.ts)}</span>
            <EntityChip n={n} />
          </span>
        </span>
      </div>
      <div className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
        <Tooltip content={n.read ? 'Mark unread' : 'Mark read'}>
          <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); n.read ? markUnread(n.id) : markRead(n.id) }} aria-label={n.read ? 'Mark unread' : 'Mark read'}><Check /></Button>
        </Tooltip>
        <Tooltip content="Dismiss">
          <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); remove(n.id) }} aria-label="Dismiss"><X /></Button>
        </Tooltip>
      </div>
    </motion.li>
  )
}

export function NotificationCenter() {
  const items = useNotifications((s) => s.items)
  const { markAllRead, clear } = useNotifications()
  const open = useUi((s) => s.notificationsOpen)
  const setOpen = useUi((s) => s.setNotificationsOpen)
  const [tab, setTab] = React.useState<'all' | 'unread' | 'critical'>('all')
  const unread = items.filter((i) => !i.read).length
  const shown = items.filter((i) => (tab === 'unread' ? !i.read : tab === 'critical' ? i.severity === 'critical' || i.severity === 'warning' : true)).slice(0, 60)

  // bell shake when a new unread notification arrives
  const prevUnread = React.useRef(unread)
  const [ring, setRing] = React.useState(0)
  React.useEffect(() => {
    if (unread > prevUnread.current) setRing((r) => r + 1)
    prevUnread.current = unread
  }, [unread])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <motion.span key={ring} animate={ring ? { rotate: [0, -16, 14, -10, 6, 0] } : undefined} transition={{ duration: 0.6 }} className="inline-flex">
            <Bell />
          </motion.span>
          {unread > 0 && (
            <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">{unread > 99 ? '99+' : unread}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div>
            <h2 className="text-[13px] font-semibold">Notifications</h2>
            <p className="text-xs text-muted-foreground">{unread ? `${unread} unread` : 'You\'re all caught up'}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={markAllRead} disabled={!unread}><CheckCheck /> Mark all read</Button>
            <Tooltip content="Clear all"><Button variant="ghost" size="icon-sm" onClick={clear} disabled={!items.length} aria-label="Clear all notifications"><Trash2 /></Button></Tooltip>
          </div>
        </div>
        <div className="border-b border-border px-3 py-2">
          <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` }, { value: 'critical', label: 'Alerts' }]} />
        </div>
        <div className="max-h-[min(460px,60dvh)] overflow-y-auto">
          {shown.length === 0 ? (
            <EmptyState compact icon={BellOff} title={tab === 'unread' ? 'No unread notifications' : 'No notifications'} description="New fleet alerts will appear here in real time." />
          ) : (
            <ul>
              <AnimatePresence initial={false}>
                {shown.map((n) => (
                  <Item key={n.id} n={n} onOpen={() => { setOpen(false); if (n.entity) openEntity(n.entity) }} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-subtle-foreground">
          <span className="flex items-center gap-1.5"><CircleAlert className="size-3" /> Simulated live events (demo)</span>
          <Button variant="link" size="xs" onClick={() => { setOpen(false); navigateTo('/admin/notifications') }}>Preferences</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BadgeCheck, BellOff, CheckCheck, CircleCheck, Cpu, Download, Info, Pencil, Plus, Radio, RefreshCw, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, UserCheck, type LucideIcon,
} from 'lucide-react'
import type { AuditEntry, EntityType, Severity } from '@/types'
import { useDb } from '@/store/db'
import { useNotifications } from '@/store/notifications'
import { useUi } from '@/store/ui'
import { openEntity } from '@/lib/navigation'
import { timeAgo, toDate } from '@/lib/format'
import { INCIDENT_TYPE } from '@/config/status'
import { Panel } from '@/components/shared/Page'
import { EntityLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { Status } from '@/components/shared/Status'
import { Badge, type Tone } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { useDash } from '../hooks/useDashboardScope'
import { ListRow, PanelEmpty, RowList, ViewAll } from './panel-kit'

/* ------------------------------------------------------------------ */
/* Live fleet alerts                                                   */
/* ------------------------------------------------------------------ */
const SEV: Record<Severity, { icon: LucideIcon; tone: Tone }> = {
  critical: { icon: ShieldAlert, tone: 'danger' },
  warning: { icon: TriangleAlert, tone: 'warning' },
  success: { icon: CircleCheck, tone: 'success' },
  info: { icon: Info, tone: 'info' },
}

export function AlertsPanel() {
  const { inScopeEntity, isAll } = useDash()
  const items = useNotifications((s) => s.items)
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const setOpen = useUi((s) => s.setNotificationsOpen)
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')

  const scoped = useMemo(() => items.filter((n) => (isAll ? true : inScopeEntity(n.entity))), [items, isAll, inScopeEntity])
  const unread = scoped.filter((n) => !n.read).length
  const shown = useMemo(() => {
    const list = scoped.filter((n) => (filter === 'unread' ? !n.read : filter === 'critical' ? n.severity === 'critical' || n.severity === 'warning' : true))
    return [...list].sort((a, b) => Number(a.read) - Number(b.read) || b.ts.localeCompare(a.ts)).slice(0, 6)
  }, [scoped, filter])

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Live fleet alerts
          {unread > 0 && <Badge tone="danger" className="num">{unread} new</Badge>}
        </span>
      }
      description="Unread first · click to open the entity"
      className="h-full"
      flush
      actions={
        <>
          <Segmented size="xs" aria-label="Alert filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'critical', label: 'Alerts' }]} />
          <ViewAll onClick={() => setOpen(true)} />
        </>
      }
    >
      {shown.length === 0 ? (
        <PanelEmpty icon={BellOff} title={filter === 'unread' ? 'No unread alerts' : 'No alerts'} description="New fleet alerts appear here in real time." />
      ) : (
        <>
          <ul className="divide-y divide-border/70">
            <AnimatePresence initial={false}>
              {shown.map((n) => {
                const s = SEV[n.severity]
                return (
                  <motion.li key={n.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                    <ul>
                      <ListRow
                        icon={s.icon}
                        tone={s.tone}
                        unread={!n.read}
                        title={n.title}
                        meta={<span className="line-clamp-1">{n.message}</span>}
                        aside={<span className="num whitespace-nowrap text-[11px] text-subtle-foreground">{timeAgo(n.ts)}</span>}
                        onClick={() => {
                          markRead(n.id)
                          if (n.entity) openEntity(n.entity)
                        }}
                      />
                    </ul>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
          {unread > 0 && (
            <div className="border-t border-border/70 px-3.5 py-1.5 text-right">
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                <CheckCheck className="size-3" /> Mark all read
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Recent operational activity                                         */
/* ------------------------------------------------------------------ */
const ENTITY_OF: Record<string, EntityType> = {
  vehicle: 'vehicle', driver: 'driver', trip: 'trip', shipment: 'shipment', customer: 'customer', workorder: 'workorder', 'work order': 'workorder',
  incident: 'incident', expense: 'expense', invoice: 'invoice', fuel: 'fuel', 'fuel transaction': 'fuel', branch: 'branch', user: 'user', document: 'document',
}

const AUDIT_ICON: Record<AuditEntry['action'], LucideIcon> = {
  create: Plus, update: Pencil, delete: Trash2, status: RefreshCw, assign: UserCheck, approve: BadgeCheck, export: Download, login: UserCheck, system: Cpu,
}

interface Activity {
  id: string
  ts: number
  kind: 'trip' | 'change' | 'event'
  icon: LucideIcon
  tone: Tone
  title: ReactNode
  meta: ReactNode
}

const EVENT_TYPES = new Set(['trip_started', 'vehicle_online', 'geofence_enter', 'geofence_exit', 'system'])

export function ActivityPanel() {
  const { trips, inScopeEntity, isAll } = useDash()
  const auditLog = useDb((s) => s.auditLog)
  const notifications = useNotifications((s) => s.items)
  const [filter, setFilter] = useState<'all' | 'trip' | 'change'>('all')

  const all = useMemo(() => {
    const out: Activity[] = []
    for (const t of trips) {
      if (t.status !== 'completed' || !t.actualEnd) continue
      out.push({
        id: `t-${t.id}`,
        ts: toDate(t.actualEnd).getTime(),
        kind: 'trip',
        icon: CheckCheck,
        tone: t.delayMinutes > 15 ? 'warning' : 'success',
        title: <span className="flex min-w-0 items-center gap-1"><TripLink id={t.id} /><span className="text-muted-foreground">delivered{t.delayMinutes > 15 ? ` (+${t.delayMinutes} min)` : ''}</span></span>,
        meta: <><span>{t.origin.city} → {t.destination.city}</span><VehicleLink id={t.vehicleId} /></>,
      })
    }
    for (const a of auditLog) {
      if (a.action === 'login') continue
      const type = ENTITY_OF[a.entityType]
      if (!isAll && !(type && inScopeEntity({ type, id: a.entityId }))) continue
      out.push({
        id: a.id,
        ts: toDate(a.at).getTime(),
        kind: 'change',
        icon: AUDIT_ICON[a.action] ?? Pencil,
        tone: a.action === 'delete' ? 'danger' : a.action === 'approve' ? 'success' : 'info',
        title: a.summary,
        meta: <><span>{a.userName}</span>{type && <EntityLink type={type} id={a.entityId} fallback="" />}</>,
      })
    }
    for (const n of notifications) {
      if (!EVENT_TYPES.has(n.type)) continue
      if (!isAll && !inScopeEntity(n.entity)) continue
      out.push({ id: n.id, ts: toDate(n.ts).getTime(), kind: 'change', icon: Radio, tone: 'neutral', title: n.title, meta: <span className="line-clamp-1">{n.message}</span> })
    }
    return out.sort((a, b) => b.ts - a.ts)
  }, [trips, auditLog, notifications, inScopeEntity, isAll])

  const shown = all.filter((a) => filter === 'all' || a.kind === filter).slice(0, 6)

  return (
    <Panel
      title="Recent operational activity"
      description="Deliveries, user changes and live events"
      className="h-full"
      flush
      actions={
        <>
          <Segmented size="xs" aria-label="Activity filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'trip', label: 'Trips' }, { value: 'change', label: 'Changes' }]} />
          <ViewAll to="/admin/audit" />
        </>
      }
    >
      {shown.length === 0 ? (
        <PanelEmpty icon={ShieldCheck} title="No recent activity" />
      ) : (
        <RowList>
          {shown.map((a) => (
            <ListRow key={a.id} icon={a.icon} tone={a.tone} title={a.title} meta={a.meta} aside={<span className="num whitespace-nowrap text-[11px] text-subtle-foreground">{timeAgo(a.ts)}</span>} />
          ))}
        </RowList>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Latest incidents                                                    */
/* ------------------------------------------------------------------ */
export function IncidentsPanel() {
  const { incidents, range } = useDash()
  const sorted = useMemo(() => [...incidents].sort((a, b) => b.date.localeCompare(a.date)), [incidents])
  const inRange = sorted.filter((i) => range.inRange(i.date)).length
  const open = sorted.filter((i) => i.status === 'reported' || i.status === 'investigating').length

  return (
    <Panel
      title="Latest incidents"
      description={`${inRange} in ${range.label.toLowerCase()} · ${open} open`}
      className="h-full"
      flush
      actions={<ViewAll to="/safety/incidents" />}
    >
      {sorted.length === 0 ? (
        <PanelEmpty icon={ShieldCheck} title="No incidents reported" description="Safe operations — nothing to report." />
      ) : (
        <RowList>
          {sorted.slice(0, 6).map((i) => (
            <ListRow
              key={i.id}
              icon={ShieldAlert}
              tone={i.severity === 'critical' || i.severity === 'major' ? 'danger' : i.severity === 'moderate' ? 'warning' : 'neutral'}
              title={<EntityLink type="incident" id={i.id}>{i.ref} · {INCIDENT_TYPE[i.type]}</EntityLink>}
              meta={<><VehicleLink id={i.vehicleId} /><span className="truncate">{i.location}</span></>}
              aside={<><Status kind="severity" value={i.severity} dot={false} /><span className="num whitespace-nowrap text-[11px] text-subtle-foreground">{timeAgo(i.date)}</span></>}
            />
          ))}
        </RowList>
      )}
    </Panel>
  )
}

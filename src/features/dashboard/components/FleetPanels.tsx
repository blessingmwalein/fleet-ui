import { useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, FileWarning, ShieldCheck, Wrench } from 'lucide-react'
import type { DocumentType } from '@/types'
import { useSettings } from '@/store/settings'
import { DOCUMENT_TYPE, statusMeta } from '@/config/status'
import { fmtDate, fmtKm, fmtNumber, toDate } from '@/lib/format'
import { useMoney } from '@/hooks/useMoney'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/shared/Page'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { ExpiryBadge, Status } from '@/components/shared/Status'
import { Badge, type Tone } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { BarList } from '@/components/charts/charts'
import { sum } from '../lib/periodStats'
import { useDash } from '../hooks/useDashboardScope'
import { useFleetLive } from '../hooks/useFleetLive'
import { ListRow, PanelEmpty, RowList, ViewAll } from './panel-kit'

const DAY = 864e5

/* ------------------------------------------------------------------ */
/* Vehicles requiring attention                                        */
/* ------------------------------------------------------------------ */
type ReasonKey = 'offline' | 'fuel' | 'service' | 'docs' | 'delayed' | 'speeding'
const REASON_META: Record<ReasonKey, { label: string; tone: Tone; weight: number }> = {
  offline: { label: 'Offline', tone: 'danger', weight: 5 },
  speeding: { label: 'Speeding', tone: 'danger', weight: 4 },
  delayed: { label: 'Trip delayed', tone: 'danger', weight: 4 },
  docs: { label: 'Docs expired', tone: 'warning', weight: 3 },
  service: { label: 'Service overdue', tone: 'warning', weight: 2 },
  fuel: { label: 'Low fuel', tone: 'warning', weight: 3 },
}
const REASON_ORDER: ReasonKey[] = ['offline', 'speeding', 'delayed', 'fuel', 'service', 'docs']

interface Reason {
  key: ReasonKey
  text: string
}

export function AttentionPanel() {
  const { schedules, documents, trips, now } = useDash()
  const live = useFleetLive()
  const lowFuel = useSettings((s) => s.thresholds.lowFuelPct)
  const [filter, setFilter] = useState<ReasonKey | null>(null)

  const static_ = useMemo(() => {
    const overdue = new Map<string, number>()
    for (const s of schedules) {
      const d = Math.floor((now - toDate(s.nextDueDate).getTime()) / DAY)
      if (d > 0) overdue.set(s.vehicleId, Math.max(overdue.get(s.vehicleId) ?? 0, d))
    }
    const expired = new Map<string, number>()
    for (const d of documents) if (d.entityType === 'vehicle' && toDate(d.expiryDate).getTime() < now) expired.set(d.entityId, (expired.get(d.entityId) ?? 0) + 1)
    const delayed = new Set(trips.filter((t) => t.status === 'delayed' && t.vehicleId).map((t) => t.vehicleId!))
    return { overdue, expired, delayed }
  }, [schedules, documents, trips, now])

  const flagged = useMemo(() => {
    const out: { id: string; row: (typeof live.rows)[number]; reasons: Reason[]; score: number }[] = []
    for (const r of live.rows) {
      const v = r.vehicle
      const reasons: Reason[] = []
      if (r.state === 'offline') reasons.push({ key: 'offline', text: v.status === 'out_of_service' ? 'Out of service' : 'GPS offline' })
      if (r.t?.speeding) reasons.push({ key: 'speeding', text: `Speeding ${Math.round(r.t.speedKph)} km/h` })
      if (static_.delayed.has(v.id)) reasons.push({ key: 'delayed', text: 'Trip delayed' })
      if (r.t && v.status === 'active' && r.t.fuelPct < lowFuel) reasons.push({ key: 'fuel', text: `Fuel ${Math.round(r.t.fuelPct)}%` })
      const od = static_.overdue.get(v.id)
      if (od) reasons.push({ key: 'service', text: `Service ${od}d overdue` })
      const ex = static_.expired.get(v.id)
      if (ex) reasons.push({ key: 'docs', text: `${ex} doc${ex > 1 ? 's' : ''} expired` })
      if (reasons.length) out.push({ id: v.id, row: r, reasons, score: sum(reasons.map((x) => REASON_META[x.key].weight)) })
    }
    return out.sort((a, b) => b.score - a.score || a.row.vehicle.reg.localeCompare(b.row.vehicle.reg))
  }, [live.rows, static_, lowFuel])

  const counts = REASON_ORDER.map((k) => [k, flagged.filter((f) => f.reasons.some((r) => r.key === k)).length] as const)
  const shown = (filter ? flagged.filter((f) => f.reasons.some((r) => r.key === filter)) : flagged).slice(0, 6)

  return (
    <Panel
      title="Vehicles requiring attention"
      description={`${flagged.length} of ${live.total} vehicles flagged`}
      className="h-full"
      flush
      actions={<ViewAll to="/vehicles" />}
    >
      <div className="flex flex-wrap gap-1 border-b border-border/70 px-3.5 py-2">
        <button type="button" onClick={() => setFilter(null)} aria-pressed={!filter} className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors', !filter ? 'border-border bg-surface-2 text-foreground' : 'border-transparent text-subtle-foreground hover:text-foreground')}>
          All {flagged.length}
        </button>
        {counts.map(([k, n]) => (
          <button key={k} type="button" disabled={!n} onClick={() => setFilter(filter === k ? null : k)} aria-pressed={filter === k} className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40', filter === k ? 'border-border bg-surface-2 text-foreground' : 'border-transparent text-subtle-foreground hover:text-foreground')}>
            {REASON_META[k].label} {n}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <PanelEmpty icon={ShieldCheck} title="Nothing needs attention" description="No offline, low-fuel, overdue or non-compliant vehicles." />
      ) : (
        <RowList>
          {shown.map((f) => (
            <ListRow
              key={f.id}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <VehicleLink id={f.id} />
                  <span className="truncate text-xs font-normal text-muted-foreground">{f.row.vehicle.make} {f.row.vehicle.model}</span>
                </span>
              }
              meta={f.reasons.map((r) => (
                <Badge key={r.key} tone={REASON_META[r.key].tone} className="px-1 py-0.5 text-[10.5px]">{r.text}</Badge>
              ))}
              aside={<Status kind="live" value={f.row.state} dot={false} />}
            />
          ))}
        </RowList>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Upcoming maintenance                                                */
/* ------------------------------------------------------------------ */
function dueBadge(ts: number, now: number) {
  const days = Math.ceil((ts - now) / DAY)
  if (days < 0) return <Badge tone="danger">{-days}d overdue</Badge>
  if (days === 0) return <Badge tone="warning">Due today</Badge>
  return <Badge tone={days <= 7 ? 'warning' : 'neutral'}>in {days}d</Badge>
}

export function UpcomingMaintenancePanel() {
  const { schedules, workOrders, now } = useDash()
  const money = useMoney()
  const [tab, setTab] = useState<'services' | 'orders'>('services')

  const services = useMemo(
    () => schedules.map((s) => ({ s, ts: toDate(s.nextDueDate).getTime() })).filter((x) => x.ts <= now + 30 * DAY).sort((a, b) => a.ts - b.ts),
    [schedules, now],
  )
  const orders = useMemo(
    () => workOrders.filter((w) => ['requested', 'approved', 'scheduled', 'in_progress'].includes(w.status)).map((w) => ({ w, ts: toDate(w.scheduledDate).getTime() })).sort((a, b) => a.ts - b.ts),
    [workOrders],
  )
  const overdue = services.filter((x) => x.ts < now).length

  return (
    <Panel
      title="Upcoming maintenance"
      description={tab === 'services' ? `${services.length} services due ≤ 30 days · ${overdue} overdue` : `${orders.length} open work orders`}
      className="h-full"
      flush
      actions={
        <>
          <Segmented size="xs" aria-label="Maintenance list" value={tab} onChange={setTab} options={[{ value: 'services', label: 'Services' }, { value: 'orders', label: 'Work orders' }]} />
          <ViewAll to={tab === 'services' ? '/maintenance/schedules' : '/maintenance/work-orders'} />
        </>
      }
    >
      {tab === 'services' ? (
        services.length === 0 ? (
          <PanelEmpty icon={CheckCircle2} title="No services due" description="Nothing falls due in the next 30 days." />
        ) : (
          <RowList>
            {services.slice(0, 6).map(({ s, ts }) => (
              <ListRow
                key={s.id}
                icon={ts < now ? CalendarClock : Wrench}
                tone={ts < now ? 'danger' : 'info'}
                title={s.task}
                meta={<><VehicleLink id={s.vehicleId} /><span>· est. {money(s.estCostUsd)}</span></>}
                aside={<>{dueBadge(ts, now)}<span className="num text-[11px] text-subtle-foreground">{fmtDate(s.nextDueDate, 'd MMM')}</span></>}
              />
            ))}
          </RowList>
        )
      ) : orders.length === 0 ? (
        <PanelEmpty icon={CheckCircle2} title="No open work orders" />
      ) : (
        <RowList>
          {orders.slice(0, 6).map(({ w, ts }) => (
            <ListRow
              key={w.id}
              icon={Wrench}
              tone={w.priority === 'critical' || w.priority === 'high' ? 'warning' : 'info'}
              title={<EntityLink type="workorder" id={w.id}>{w.woNo} · {w.title}</EntityLink>}
              meta={<><VehicleLink id={w.vehicleId} /><span>· {statusMeta('priority', w.priority).label} priority</span></>}
              aside={<><Status kind="workorder" value={w.status} dot={false} /><span className="num text-[11px] text-subtle-foreground">{dueBadgeText(ts, now)}</span></>}
            />
          ))}
        </RowList>
      )}
    </Panel>
  )
}

function dueBadgeText(ts: number, now: number) {
  const days = Math.ceil((ts - now) / DAY)
  return days < 0 ? `${-days}d late` : days === 0 ? 'today' : `in ${days}d`
}

/* ------------------------------------------------------------------ */
/* Expiring documents                                                  */
/* ------------------------------------------------------------------ */
interface DocItem {
  key: string
  docId: string | null
  entityType: 'vehicle' | 'driver'
  entityId: string
  type: DocumentType
  number: string | null
  expiry: string
  days: number
}

export function ExpiringDocumentsPanel() {
  const { documents, drivers, now } = useDash()
  const warn = useSettings((s) => s.thresholds.docExpiryWarnDays)
  const [filter, setFilter] = useState<'all' | 'expired' | 'soon'>('all')

  const items = useMemo(() => {
    const map = new Map<string, DocItem>()
    for (const d of documents) {
      map.set(`${d.entityType}:${d.entityId}:${d.type}`, { key: d.id, docId: d.id, entityType: d.entityType, entityId: d.entityId, type: d.type, number: d.number, expiry: d.expiryDate, days: 0 })
    }
    // driver licence fields can be edited independently of the filed document — the later date wins
    const fields: [DocumentType, (x: (typeof drivers)[number]) => string][] = [
      ['driver_licence', (x) => x.licenceExpiry],
      ['defensive_driving', (x) => x.defensiveDrivingExpiry],
      ['medical', (x) => x.medicalExpiry],
    ]
    for (const dr of drivers) {
      for (const [type, get] of fields) {
        const k = `driver:${dr.id}:${type}`
        const cur = map.get(k)
        const exp = get(dr)
        if (!cur) map.set(k, { key: k, docId: null, entityType: 'driver', entityId: dr.id, type, number: null, expiry: exp, days: 0 })
        else if (toDate(exp).getTime() > toDate(cur.expiry).getTime()) cur.expiry = exp
      }
    }
    return [...map.values()]
      .map((x) => ({ ...x, days: Math.ceil((toDate(x.expiry).getTime() - now) / DAY) }))
      .filter((x) => x.days <= warn)
      .sort((a, b) => a.days - b.days)
  }, [documents, drivers, now, warn])

  const expired = items.filter((x) => x.days < 0).length
  const shown = items.filter((x) => (filter === 'expired' ? x.days < 0 : filter === 'soon' ? x.days >= 0 : true)).slice(0, 6)

  return (
    <Panel
      title="Expiring documents"
      description={`${expired} expired · ${items.length - expired} expiring within ${warn} days`}
      className="h-full"
      flush
      actions={
        <>
          <Segmented size="xs" aria-label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'expired', label: 'Expired' }, { value: 'soon', label: 'Soon' }]} />
          <ViewAll to="/safety/compliance" />
        </>
      }
    >
      {shown.length === 0 ? (
        <PanelEmpty icon={ShieldCheck} title="All documents valid" description="No licences or certificates are expiring." />
      ) : (
        <RowList>
          {shown.map((x) => (
            <ListRow
              key={x.key}
              icon={FileWarning}
              tone={x.days < 0 ? 'danger' : x.days <= 14 ? 'warning' : 'info'}
              title={x.docId ? <EntityLink type="document" id={x.docId}>{DOCUMENT_TYPE[x.type]}</EntityLink> : DOCUMENT_TYPE[x.type]}
              meta={
                <>
                  <EntityLink type={x.entityType} id={x.entityId} />
                  <span>· {x.entityType}</span>
                  {x.number && <span className="font-mono text-[10.5px] text-subtle-foreground">{x.number}</span>}
                </>
              }
              aside={<><ExpiryBadge iso={x.expiry} warnDays={warn} /><span className="num text-[11px] text-subtle-foreground">{fmtDate(x.expiry, 'd MMM yyyy')}</span></>}
            />
          ))}
        </RowList>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Top-performing vehicles                                             */
/* ------------------------------------------------------------------ */
type TopMetric = 'revenue' | 'km' | 'economy' | 'utilisation'

export function TopVehiclesPanel() {
  const { trips, fuel, vehicles, range } = useDash()
  const money = useMoney()
  const [metric, setMetric] = useState<TopMetric>('revenue')

  const stats = useMemo(() => {
    const m = new Map<string, { revenue: number; km: number; trips: number; days: Set<string>; litres: number }>()
    const get = (id: string) => {
      let x = m.get(id)
      if (!x) m.set(id, (x = { revenue: 0, km: 0, trips: 0, days: new Set(), litres: 0 }))
      return x
    }
    for (const t of trips) {
      if (t.status !== 'completed' || !t.vehicleId || !range.inRange(t.actualEnd)) continue
      const x = get(t.vehicleId)
      x.revenue += t.revenueUsd
      x.km += t.actualDistanceKm ?? 0
      x.trips++
      if (t.actualStart) x.days.add(t.actualStart.slice(0, 10))
    }
    for (const f of fuel) if (range.inRange(f.date)) get(f.vehicleId).litres += f.litres
    return m
  }, [trips, fuel, range])

  const items = useMemo(() => {
    const ids = new Set(vehicles.map((v) => v.id))
    const val = (id: string) => {
      const x = stats.get(id)!
      return metric === 'revenue' ? x.revenue : metric === 'km' ? x.km : metric === 'utilisation' ? Math.min(100, (x.days.size / Math.max(1, range.days)) * 100) : x.litres >= 20 ? x.km / x.litres : 0
    }
    return [...stats.keys()]
      .filter((id) => ids.has(id))
      .map((id) => ({ id, v: val(id), x: stats.get(id)! }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 6)
  }, [stats, vehicles, metric, range.days])

  const fmt = (v: number) => (metric === 'revenue' ? money(v, { compact: true }) : metric === 'km' ? fmtKm(v) : metric === 'utilisation' ? `${v.toFixed(0)}%` : `${v.toFixed(2)} km/L`)

  return (
    <Panel
      title="Top-performing vehicles"
      description={`Ranked by ${metric === 'revenue' ? 'revenue' : metric === 'km' ? 'distance' : metric === 'economy' ? 'fuel economy' : 'days in service'} · ${range.label.toLowerCase()}`}
      className="h-full"
      actions={<ViewAll to="/reports/vehicle-performance" />}
    >
      <div className="mb-3">
        <Segmented size="xs" aria-label="Ranking metric" value={metric} onChange={setMetric} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'km', label: 'Distance' }, { value: 'economy', label: 'km/L' }, { value: 'utilisation', label: 'Utilisation' }]} />
      </div>
      <BarList
        items={items.map((r) => ({ label: <VehicleLink id={r.id} />, sub: `${r.x.trips} trips · ${fmtNumber(r.x.km)} km`, value: r.v, color: 'var(--chart-1)' }))}
        format={fmt}
        className="space-y-3"
        emptyText="No completed trips in this period"
      />
    </Panel>
  )
}

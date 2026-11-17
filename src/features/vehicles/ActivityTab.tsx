import { useMemo, useState, type ReactNode } from 'react'
import { ClipboardCheck, FileText, Fuel, History, Route, ShieldAlert, Wrench } from 'lucide-react'
import type { Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { useById } from '@/hooks/useLookup'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink, TripLink } from '@/components/shared/EntityLink'
import { Panel, Timeline, type TimelineItem } from '@/components/shared/Page'
import { DOCUMENT_TYPE, WORKORDER_STATUS, INCIDENT_TYPE } from '@/config/status'
import { fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { useVehicleDocuments, useVehicleFuel, useVehicleIncidents, useVehicleInspections, useVehicleTrips, useVehicleWorkOrders } from './useVehicleData'

export type ActivityKind = 'trip' | 'maintenance' | 'fuel' | 'safety' | 'document' | 'audit'

export interface ActivityItem {
  id: string
  ts: number
  kind: ActivityKind
  title: ReactNode
  description?: ReactNode
  tone?: TimelineItem['tone']
  icon: ReactNode
}

const ic = 'size-3'

/** Unified, newest-first history of everything that happened to a vehicle. */
export function useVehicleActivity(v: Vehicle): ActivityItem[] {
  const trips = useVehicleTrips(v.id)
  const workOrders = useVehicleWorkOrders(v.id)
  const fuel = useVehicleFuel(v.id)
  const incidents = useVehicleIncidents(v.id)
  const inspections = useVehicleInspections(v.id)
  const docs = useVehicleDocuments(v.id)
  const audit = useDb((s) => s.auditLog)
  const getStation = useById('fuelStations')

  return useMemo(() => {
    const now = Date.now()
    const out: ActivityItem[] = []
    for (const t of trips) {
      const ts = new Date(t.actualEnd ?? t.actualStart ?? t.scheduledStart).getTime()
      if (t.status === 'scheduled' || t.status === 'ready' || t.status === 'awaiting_assignment') continue
      out.push({
        id: `trip-${t.id}`, ts, kind: 'trip', icon: <Route className={ic} />,
        tone: t.status === 'delayed' ? 'warning' : t.status === 'cancelled' ? 'danger' : 'default',
        title: <span><TripLink id={t.id} /> {t.status === 'completed' ? 'completed' : t.status === 'cancelled' ? 'cancelled' : t.status === 'delayed' ? 'delayed' : 'in transit'}</span>,
        description: `${t.origin.city} → ${t.destination.city} · ${fmtNumber(t.actualDistanceKm ?? t.plannedDistanceKm)} km${t.delayMinutes > 15 ? ` · ${t.delayMinutes} min late` : ''}`,
      })
    }
    for (const w of workOrders) {
      const ts = new Date(w.completedAt ?? w.startedAt ?? w.requestedAt).getTime()
      out.push({
        id: `wo-${w.id}`, ts, kind: 'maintenance', icon: <Wrench className={ic} />, tone: w.priority === 'critical' ? 'danger' : 'default',
        title: <span><EntityLink type="workorder" id={w.id} /> · {w.title}</span>,
        description: `${WORKORDER_STATUS[w.status].label}${w.status === 'completed' ? ` · ${fmtNumber(w.labourCostUsd + w.partsCostUsd)} USD · ${w.downtimeHours}h downtime` : ''}`,
      })
    }
    for (const f of fuel) {
      out.push({
        id: `fuel-${f.id}`, ts: new Date(f.date).getTime(), kind: 'fuel', icon: <Fuel className={ic} />, tone: f.flag ? 'warning' : 'default',
        title: <span>Refuelled {fmtNumber(f.litres, 0)} L · <EntityLink type="fuel" id={f.id} /></span>,
        description: `${getStation(f.stationId)?.name ?? 'Station'} · odometer ${fmtNumber(f.odometerKm)} km${f.flag ? ` · flagged: ${f.flag.reason}` : ''}`,
      })
    }
    for (const i of incidents) {
      out.push({
        id: `inc-${i.id}`, ts: new Date(i.date).getTime(), kind: 'safety', icon: <ShieldAlert className={ic} />, tone: i.severity === 'minor' ? 'warning' : 'danger',
        title: <span><EntityLink type="incident" id={i.id} /> · {INCIDENT_TYPE[i.type]} ({i.severity})</span>,
        description: i.location,
      })
    }
    for (const i of inspections) {
      out.push({
        id: `ins-${i.id}`, ts: new Date(i.date).getTime(), kind: 'safety', icon: <ClipboardCheck className={ic} />, tone: i.result === 'fail' ? 'danger' : i.result === 'conditional' ? 'warning' : 'default',
        title: `${i.ref} · ${i.type.replace('_', '-')} inspection — ${i.result}`,
        description: i.defects.length ? `${i.defects.length} defect${i.defects.length > 1 ? 's' : ''}: ${i.defects[0]}` : 'No defects found',
      })
    }
    for (const d of docs) {
      out.push({
        id: `doc-${d.id}`, ts: new Date(d.uploadedAt).getTime(), kind: 'document', icon: <FileText className={ic} />,
        title: <span>{DOCUMENT_TYPE[d.type]} <EntityLink type="document" id={d.id} /> uploaded</span>,
        description: `By ${d.uploadedBy} · valid until ${new Date(d.expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      })
    }
    for (const a of audit) {
      if (a.entityId !== v.id) continue
      out.push({ id: `aud-${a.id}`, ts: new Date(a.at).getTime(), kind: 'audit', icon: <History className={ic} />, title: a.summary, description: `${a.userName} · ${a.action}` })
    }
    return out.filter((x) => x.ts <= now + 864e5).sort((a, b) => b.ts - a.ts)
  }, [trips, workOrders, fuel, incidents, inspections, docs, audit, v.id, getStation])
}

export const toTimeline = (items: ActivityItem[]): TimelineItem[] =>
  items.map((i) => ({ id: i.id, title: i.title, description: i.description, time: timeAgo(i.ts), tone: i.tone, icon: i.icon }))

type Filter = 'all' | ActivityKind

export function ActivityTab({ vehicle }: { vehicle: Vehicle }) {
  const all = useVehicleActivity(vehicle)
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(30)
  const filtered = useMemo(() => (filter === 'all' ? all : all.filter((a) => a.kind === filter)), [all, filter])
  const count = (k: ActivityKind) => all.filter((a) => a.kind === k).length
  const shown = filtered.slice(0, limit)

  return (
    <Panel
      title="Activity history"
      description={`${filtered.length} event${filtered.length === 1 ? '' : 's'} — trips, work orders, fuel, safety, documents and record changes`}
      actions={
        <Segmented<Filter>
          aria-label="Filter activity"
          value={filter}
          onChange={(v) => { setFilter(v); setLimit(30) }}
          options={[
            { value: 'all', label: `All ${all.length}` },
            { value: 'trip', label: `Trips ${count('trip')}` },
            { value: 'maintenance', label: `Maint. ${count('maintenance')}` },
            { value: 'fuel', label: `Fuel ${count('fuel')}` },
            { value: 'safety', label: `Safety ${count('safety')}` },
            { value: 'document', label: `Docs ${count('document')}` },
            { value: 'audit', label: `Changes ${count('audit')}` },
          ]}
        />
      }
    >
      {shown.length === 0 ? (
        <EmptyState compact icon={History} title="No activity yet" description="Events appear here as trips, work orders and record changes happen." />
      ) : (
        <>
          <div className="grid gap-x-8 lg:grid-cols-1">
            <Timeline items={shown.map((i) => ({ id: i.id, title: i.title, description: i.description, time: fmtDateTime(i.ts), tone: i.tone, icon: i.icon }))} />
          </div>
          {filtered.length > limit && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 30)}>Show more ({filtered.length - limit} remaining)</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

import { useMemo, useState } from 'react'
import { sumBy } from '@/lib/analytics'
import { fmtNumber } from '@/lib/format'
import { useMoney } from '@/hooks/useMoney'
import { VEHICLE_CATEGORY, WORKORDER_TYPE } from '@/config/status'
import { BarList, ChartCard, DonutChart, chartColor } from '@/components/charts/charts'
import { DriverLink } from '@/components/shared/EntityLink'
import { Segmented } from '@/components/ui/segmented'
import { sum, workOrderCost } from '../lib/periodStats'
import { useDash } from '../hooks/useDashboardScope'
import { PanelEmpty, ViewAll } from './panel-kit'
import { Wrench } from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Driver performance — ranked bars, top / bottom 5                    */
/* ------------------------------------------------------------------ */
type DriverMetric = 'score' | 'trips'

const scoreColor = (s: number) => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--warning)' : 'var(--danger)')

export function DriverPerformanceChart() {
  const { drivers, trips, safetyEvents, range } = useDash()
  const [rank, setRank] = useState<'top' | 'bottom'>('top')
  const [metric, setMetric] = useState<DriverMetric>('score')

  const rows = useMemo(() => {
    const tripCount = new Map<string, number>()
    for (const t of trips) if (t.status === 'completed' && t.driverId && range.inRange(t.actualEnd)) tripCount.set(t.driverId, (tripCount.get(t.driverId) ?? 0) + 1)
    const events = new Map<string, number>()
    for (const e of safetyEvents) if (e.driverId && range.inRange(e.timestamp)) events.set(e.driverId, (events.get(e.driverId) ?? 0) + 1)
    return drivers
      .filter((d) => d.status === 'active' || d.status === 'off_duty')
      .map((d) => ({ d, score: d.safetyScore, trips: tripCount.get(d.id) ?? 0, events: events.get(d.id) ?? 0 }))
  }, [drivers, trips, safetyEvents, range])

  const items = useMemo(() => {
    const key = (r: (typeof rows)[number]) => (metric === 'score' ? r.score : r.trips)
    const sorted = [...rows].sort((a, b) => (rank === 'top' ? key(b) - key(a) || b.trips - a.trips : key(a) - key(b) || a.d.name.localeCompare(b.d.name)))
    return sorted.slice(0, 5).map((r) => ({
      label: <DriverLink id={r.d.id} avatar />,
      sub: metric === 'score' ? `${r.trips} trips` : `score ${r.score}`,
      value: key(r),
      color: metric === 'score' ? scoreColor(r.score) : 'var(--chart-2)',
    }))
  }, [rows, rank, metric])

  const avgScore = rows.length ? sum(rows.map((r) => r.score)) / rows.length : 0

  return (
    <ChartCard
      title="Driver performance"
      description={`${rank === 'top' ? 'Top' : 'Bottom'} 5 by ${metric === 'score' ? 'safety score' : 'trips completed'} · fleet avg ${avgScore.toFixed(0)}`}
      className="h-full"
      actions={
        <>
          <Segmented size="xs" aria-label="Rank" value={rank} onChange={setRank} options={[{ value: 'top', label: 'Top 5' }, { value: 'bottom', label: 'Bottom 5' }]} />
          <ViewAll to="/safety/behaviour" />
        </>
      }
    >
      <div className="mb-3">
        <Segmented size="xs" aria-label="Metric" value={metric} onChange={setMetric} options={[{ value: 'score', label: 'Safety score' }, { value: 'trips', label: 'Trips completed' }]} />
      </div>
      <BarList items={items} max={metric === 'score' ? 100 : undefined} format={(v) => fmtNumber(v)} className="space-y-3" emptyText="No drivers in this scope" />
    </ChartCard>
  )
}

/* ------------------------------------------------------------------ */
/* Maintenance cost breakdown — donut by work-order type / bars by category */
/* ------------------------------------------------------------------ */
export function MaintenanceCostChart() {
  const { workOrders, trend, vehicleById } = useDash()
  const money = useMoney()
  const [view, setView] = useState<'type' | 'category'>('type')

  const done = useMemo(() => workOrders.filter((w) => w.status === 'completed' && trend.inRange(w.completedAt)), [workOrders, trend])
  const total = sum(done.map(workOrderCost))

  const byType = useMemo(() => sumBy(done, (w) => WORKORDER_TYPE[w.type], workOrderCost).map(([name, value], i) => ({ name, value: Math.round(value), color: chartColor(i) })), [done])
  const byCategory = useMemo(
    () => sumBy(done, (w) => {
      const c = vehicleById.get(w.vehicleId)?.category
      return c ? VEHICLE_CATEGORY[c] : 'Other'
    }, workOrderCost),
    [done, vehicleById],
  )

  return (
    <ChartCard
      title="Maintenance cost breakdown"
      description={`${done.length} completed work orders${trend.extended ? ' · last 7 days' : ''}`}
      className="h-full"
      actions={
        <>
          <Segmented size="xs" aria-label="Breakdown" value={view} onChange={setView} options={[{ value: 'type', label: 'By type' }, { value: 'category', label: 'By category' }]} />
          <ViewAll to="/reports/maintenance-costs" />
        </>
      }
    >
      {!done.length ? (
        <PanelEmpty icon={Wrench} title="No completed work orders" description="Nothing was completed in this period." />
      ) : view === 'type' ? (
        <DonutChart data={byType} height={168} centerLabel="total cost" centerValue={money(total, { compact: true })} format={(v) => money(v, { compact: true })} />
      ) : (
        <BarList
          items={byCategory.map(([name, value], i) => ({ label: name, value: Math.round(value), color: chartColor(i) }))}
          format={(v) => money(v, { compact: true })}
          className="space-y-3"
        />
      )}
    </ChartCard>
  )
}

import { CheckCircle2, Clock, Gauge, Hourglass, Route, Timer } from 'lucide-react'
import { PRIORITY } from '@/config/status'
import { DIM_BRANCH, DIM_CARGO, DIM_CATEGORY, DIM_CUSTOMER, DIM_DRIVER, DIM_ROUTE, inWin, PERIOD_DIM, tripFact } from './common'
import { C, rt, sm } from './dsl'
import type { DimDef, Fact, ReportSpec, Sums } from './types'

const DIM_REASON: DimDef = { value: 'reason', label: 'Delay reason', resolve: (_ds, k) => ({ label: k || 'None recorded' }) }
const DIM_PRIORITY: DimDef = { value: 'priority', label: 'Priority', resolve: (_ds, k) => ({ label: PRIORITY[k]?.label ?? k }) }

const pctVar = (a: string, b: string) => (s: Sums): number | null => {
  const base = s.m[b] ?? 0
  return base > 0 ? (((s.m[a] ?? 0) - base) / base) * 100 : null
}

export const tripPerformance: ReportSpec = {
  slug: 'trip-performance',
  dims: [DIM_ROUTE, DIM_BRANCH, DIM_CARGO, DIM_DRIVER,DIM_CATEGORY, DIM_CUSTOMER, DIM_REASON, DIM_PRIORITY, PERIOD_DIM],
  defaultGroup: 'route',
  fallbackDim: 'route',
  metrics: ['trips', 'onTime', 'avgDelay', 'completion', 'km', 'revenue'],
  defaultMetric: 'trips',
  measures: {
    trips: { label: 'Trips', kind: 'int', fn: sm('trips'), goodWhen: 'up', hint: 'Trips started in the period (completed, cancelled, in transit).' },
    completed: { label: 'Completed', kind: 'int', fn: sm('completed'), goodWhen: 'up' },
    cancelled: { label: 'Cancelled', kind: 'int', fn: sm('cancelled'), goodWhen: 'down' },
    active: { label: 'In transit', kind: 'int', fn: sm('active') },
    completion: { label: 'Completion rate', kind: 'pct1', fn: (s) => { const done = (s.m.completed ?? 0) + (s.m.cancelled ?? 0); return done > 0 ? ((s.m.completed ?? 0) / done) * 100 : null }, goodWhen: 'up', tone: { good: 96, warn: 90 }, hint: 'Completed ÷ (completed + cancelled).' },
    onTime: { label: 'On-time %', kind: 'pct1', fn: rt('onTime', 'completed', 100), goodWhen: 'up', tone: { good: 85, warn: 70 }, hint: 'Completed trips arriving within 15 min of plan.' },
    late: { label: 'Late trips', kind: 'int', fn: sm('late'), goodWhen: 'down' },
    avgDelay: { label: 'Avg delay (late trips)', kind: 'minutes', fn: rt('delayMin', 'late'), goodWhen: 'down', hint: 'Average minutes over plan on late trips.' },
    plannedKm: { label: 'Planned km', kind: 'km', fn: sm('plannedKm') },
    km: { label: 'Actual km', kind: 'km', fn: sm('km'), goodWhen: 'up' },
    distVar: { label: 'Distance variance', kind: 'pct1', fn: pctVar('km', 'plannedKm'), hint: 'Actual vs planned distance (completed trips).' },
    plannedH: { label: 'Planned hours', kind: 'hours', fn: sm('plannedH') },
    hours: { label: 'Actual hours', kind: 'hours', fn: sm('hours') },
    durVar: { label: 'Duration variance', kind: 'pct1', fn: pctVar('hours', 'plannedH'), goodWhen: 'down', hint: 'Actual vs planned driving time (completed trips).' },
    avgDuration: { label: 'Avg duration', kind: 'minutes', fn: (s) => ((s.m.completed ?? 0) > 0 ? ((s.m.hours ?? 0) / (s.m.completed ?? 1)) * 60 : null) },
    revenue: { label: 'Revenue', kind: 'usd', fn: sm('revenue'), goodWhen: 'up' },
    revPerTrip: { label: 'Revenue / trip', kind: 'usd', fn: rt('revenue', 'completed'), goodWhen: 'up' },
    tripMargin: { label: 'Trip margin', kind: 'usd', fn: (s) => (s.m.revenue ?? 0) - (s.m.tripCost ?? 0), goodWhen: 'up', hint: 'Revenue minus the fuel and expenses charged directly to the trip.' },
  },
  columns: [{ key: 'trips', bar: true, size: 120 }, 'completed', 'cancelled', 'completion', 'onTime', 'late', 'avgDelay', 'plannedKm', 'km', 'distVar', 'plannedH', 'hours', 'durVar', 'revenue', 'tripMargin'],
  kpis: [
    { measure: 'trips', icon: Route, spark: true },
    { measure: 'completion', icon: CheckCircle2, spark: true },
    { measure: 'onTime', icon: Timer, spark: true },
    { measure: 'avgDelay', icon: Hourglass, spark: true },
    { measure: 'km', icon: Gauge, spark: true },
    { measure: 'avgDuration', icon: Clock, label: 'Avg trip duration' },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Trip volume and punctuality', description: 'Trips per period with on-time % on the right axis', span: 2,
      series: [{ measure: 'completed', type: 'bar', color: C.green }, { measure: 'late', type: 'bar', color: C.amber }, { measure: 'onTime', type: 'line', axis: 'right', color: C.blue }],
    },
    { id: 'rank', type: 'ranking', title: 'Trip ranking' },
    { id: 'share', type: 'share', title: 'Why trips ran late', dim: 'reason', measure: 'late', centerLabel: 'late trips' },
    {
      id: 'plan', type: 'trend', title: 'Planned vs actual driving time', description: 'Hours on completed trips', span: 2,
      series: [{ measure: 'plannedH', type: 'line', color: C.grey, dashed: true }, { measure: 'hours', type: 'area', color: C.blue }],
    },
  ],
  facts: (ds, w) => {
    const out: Fact[] = []
    for (const t of ds.trips) {
      if (t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'in_transit' && t.status !== 'delayed') continue
      const at = Date.parse(t.actualStart ?? t.scheduledStart)
      if (inWin(at, w)) out.push(tripFact(ds, t, at))
    }
    return out
  },
  definitions: [
    'A trip belongs to the period it started in. Completion rate = completed ÷ (completed + cancelled); in-transit trips are excluded.',
    'On time = completed within 15 minutes of the planned duration. Delay reasons come from the driver / dispatcher log; delays over 15 min with no reason are “Unspecified”.',
    'Planned vs actual distance and duration are compared on completed trips only.',
    'Trip margin uses expenses and fuel charged directly to the trip (allowances, tolls, fuel).',
  ],
}

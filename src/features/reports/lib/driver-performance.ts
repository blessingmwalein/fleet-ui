import { AlertTriangle, ShieldCheck, Timer, UserRound, Route, Siren } from 'lucide-react'
import { completedTripFacts, DIM_BRANCH, DIM_DRIVER, inWin, PERIOD_DIM, ts } from './common'
import { C, dc, rt, sm } from './dsl'
import type { DimDef, Fact, ReportSpec } from './types'
import type { Dataset } from './common'

const band = (score: number) => (score >= 90 ? 'Excellent (90+)' : score >= 80 ? 'Good (80–89)' : score >= 70 ? 'Fair (70–79)' : 'At risk (<70)')
const EMP: Record<string, string> = { permanent: 'Permanent', contract: 'Contract', casual: 'Casual' }

const DIM_BAND: DimDef = { value: 'band', label: 'Safety band', resolve: (_ds, k) => ({ label: k || 'Unrated' }) }
const DIM_EMP: DimDef = { value: 'employment', label: 'Employment type', resolve: (_ds, k) => ({ label: EMP[k] ?? 'Unknown' }) }

const dd = (ds: Dataset, driverId: string | null, vehicleId: string, branch: string) => {
  const d = driverId ? ds.driverById.get(driverId) : undefined
  return { driver: driverId ?? '', vehicle: vehicleId, branch, band: d ? band(d.safetyScore) : '', employment: d?.employmentType ?? '' }
}

export const driverPerformance: ReportSpec = {
  slug: 'driver-performance',
  dims: [DIM_DRIVER, DIM_BRANCH, DIM_BAND, DIM_EMP, PERIOD_DIM],
  defaultGroup: 'driver',
  fallbackDim: 'driver',
  metrics: ['perfScore', 'onTime', 'safetyScore', 'eventsPer1000', 'trips', 'km'],
  defaultMetric: 'perfScore',
  distinct: ['driver'],
  measures: {
    drivers: { label: 'Drivers', kind: 'int', fn: dc('driver') },
    trips: { label: 'Trips', kind: 'int', fn: sm('completed'), goodWhen: 'up' },
    km: { label: 'Distance', kind: 'km', fn: sm('km'), goodWhen: 'up' },
    hours: { label: 'Hours driven', kind: 'hours', fn: sm('hours'), goodWhen: 'up' },
    revenue: { label: 'Revenue', kind: 'usd', fn: sm('revenue'), goodWhen: 'up' },
    onTime: { label: 'On-time %', kind: 'pct1', fn: rt('onTime', 'completed', 100), goodWhen: 'up', tone: { good: 85, warn: 70 }, hint: `Completed trips arriving within 15 min of plan.` },
    avgDelay: { label: 'Avg delay', kind: 'minutes', fn: rt('delayMin', 'completed'), goodWhen: 'down', hint: 'Average minutes behind plan per completed trip.' },
    safetyScore: { label: 'Safety score', kind: 'num1', fn: rt('scoreSum', 'completed'), goodWhen: 'up', tone: { good: 85, warn: 70 }, hint: 'Driver safety score (0–100), weighted by trips.' },
    events: { label: 'Safety events', kind: 'int', fn: sm('events'), goodWhen: 'down' },
    highEvents: { label: 'High severity', kind: 'int', fn: sm('highEvents'), goodWhen: 'down' },
    eventsPer1000: { label: 'Events / 1,000 km', kind: 'num2', fn: rt('events', 'km', 1000), goodWhen: 'down', tone: { good: 2, warn: 5, invert: true }, hint: 'Harsh braking, speeding, fatigue… per 1,000 km driven.' },
    incidents: { label: 'Incidents', kind: 'int', fn: sm('incidents'), goodWhen: 'down' },
    l100: { label: 'L / 100 km', kind: 'num1', fn: rt('litres', 'km', 100), goodWhen: 'down' },
    perfScore: {
      label: 'Performance index', kind: 'num1', goodWhen: 'up', tone: { good: 85, warn: 70 }, hint: 'Average of on-time % and safety score.',
      fn: (s) => {
        const c = s.m.completed ?? 0
        if (!c) return null
        return ((s.m.onTime ?? 0) / c) * 50 + ((s.m.scoreSum ?? 0) / c) * 0.5
      },
    },
  },
  attrs: {
    dstatus: { label: 'Status', kind: 'text', status: 'driver', dims: ['driver'], size: 110, fn: (k, _d, x) => x.ds.driverById.get(k)?.status ?? null },
    dveh: { label: 'Vehicle', kind: 'text', dims: ['driver'], size: 100, fn: (k, _d, x) => { const v = x.ds.driverById.get(k)?.vehicleId; return v ? (x.ds.vehicleById.get(v)?.reg ?? null) : null } },
  },
  columns: ['dstatus', { key: 'perfScore', bar: true, size: 140 }, 'trips', 'km', 'hours', 'onTime', 'avgDelay', 'safetyScore', 'events', 'highEvents', 'eventsPer1000', 'incidents', 'l100', 'revenue'],
  kpis: [
    { measure: 'drivers', icon: UserRound, label: 'Drivers on trips' },
    { measure: 'trips', icon: Route, spark: true },
    { measure: 'onTime', icon: Timer, spark: true },
    { measure: 'safetyScore', icon: ShieldCheck, label: 'Avg safety score' },
    { measure: 'eventsPer1000', icon: AlertTriangle, spark: true },
    { measure: 'incidents', icon: Siren },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Trips and on-time performance', description: 'Completed trips per period with on-time % on the right axis', span: 2,
      series: [{ measure: 'trips', type: 'bar', color: C.green }, { measure: 'onTime', type: 'line', axis: 'right', color: C.blue }],
    },
    { id: 'rank', type: 'ranking', title: 'Driver ranking' },
    { id: 'share', type: 'share', title: 'Drivers by safety band', dim: 'band', measure: 'drivers', centerLabel: 'drivers' },
    {
      id: 'safety', type: 'trend', title: 'Safety event rate', description: 'Events per 1,000 km with absolute events alongside', span: 2,
      series: [{ measure: 'events', type: 'bar', color: C.amber }, { measure: 'eventsPer1000', type: 'line', axis: 'right', color: C.red }],
    },
  ],
  facts: (ds, w) => {
    const out: Fact[] = []
    for (const f of completedTripFacts(ds, w)) {
      const sc = ds.driverById.get(f.d.driver!)?.safetyScore ?? 0
      out.push({ ...f, d: { ...f.d, ...dd(ds, f.d.driver || null, f.d.vehicle!, f.d.branch!) }, m: { ...f.m, scoreSum: sc } })
    }
    for (const e of ds.events) {
      const t = ts(e.timestamp)
      if (!inWin(t, w)) continue
      out.push({ t, d: dd(ds, e.driverId, e.vehicleId, e.branchId), m: { events: 1, highEvents: e.severity === 'high' ? 1 : 0 } })
    }
    for (const i of ds.incidents) {
      const t = ts(i.date)
      if (inWin(t, w)) out.push({ t, d: dd(ds, i.driverId, i.vehicleId, i.branchId), m: { incidents: 1 } })
    }
    for (const f of ds.fuel) {
      const t = ts(f.date)
      if (inWin(t, w)) out.push({ t, d: dd(ds, f.driverId, f.vehicleId, f.branchId), m: { litres: f.litres } })
    }
    return out
  },
  keepRow: (_s, key, g) => g !== 'driver' || !!key,
  definitions: [
    'Trips, distance and on-time % use completed trips attributed to the driver; on-time means arriving within 15 minutes of plan.',
    'Safety score is the driver’s current 0–100 score; the performance index averages on-time % and safety score.',
    'Safety events come from telematics (harsh braking/acceleration, speeding, fatigue…); incidents are reported accidents, breakdowns and thefts.',
    'Fuel efficiency divides litres bought by the driver by km driven — fills not tied to a trip may skew individual figures.',
  ],
}

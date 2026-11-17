import { Activity, Clock, Gauge, Route, TrendingDown, Truck } from 'lucide-react'
import { makeBuckets } from '@/lib/analytics'
import { DIM_BRANCH, DIM_CATEGORY, DIM_DRIVER, DIM_VEHICLE, PERIOD_DIM, vehicleDayFacts } from './common'
import { C, dc, rt, sm } from './dsl'
import type { ReportSpec, Sums } from './types'

const OPERATING_HOURS = 12

const util = (s: Sums) => rt('activeDays', 'availDays', 100)(s)

export const fleetUtilisation: ReportSpec = {
  slug: 'fleet-utilisation',
  dims: [DIM_VEHICLE, DIM_CATEGORY, DIM_BRANCH, DIM_DRIVER, PERIOD_DIM],
  defaultGroup: 'vehicle',
  fallbackDim: 'vehicle',
  metrics: ['util', 'hoursUtil', 'hours', 'km'],
  defaultMetric: 'util',
  distinct: ['vehicle', 'activeVehicle'],
  measures: {
    util: { label: 'Utilisation', kind: 'pct1', fn: util, goodWhen: 'up', hint: 'Vehicle-days with at least one trip ÷ available vehicle-days (after workshop downtime).', tone: { good: 55, warn: 35 } },
    hoursUtil: { label: 'Time utilisation', kind: 'pct1', fn: (s) => rt('hours', 'availDays', 100 / OPERATING_HOURS)(s), goodWhen: 'up', hint: `Driving hours ÷ (available days × ${OPERATING_HOURS} h operating window).`, tone: { good: 40, warn: 20 } },
    activeDays: { label: 'Active days', kind: 'int', fn: sm('activeDays'), goodWhen: 'up' },
    availDays: { label: 'Available days', kind: 'num1', fn: sm('availDays') },
    trips: { label: 'Trips', kind: 'int', fn: sm('vdTrips'), goodWhen: 'up' },
    km: { label: 'Distance', kind: 'km', fn: sm('km'), goodWhen: 'up' },
    hours: { label: 'Driving hours', kind: 'hours', fn: sm('hours'), goodWhen: 'up' },
    kmPerActive: { label: 'Km / active day', kind: 'km', fn: rt('km', 'activeDays') },
    tripsPerActive: { label: 'Trips / active day', kind: 'num2', fn: rt('vdTrips', 'activeDays') },
    downH: { label: 'Workshop downtime', kind: 'hours', fn: sm('downH'), goodWhen: 'down', hint: 'Hours vehicles were in the workshop (completed + in-progress work orders).' },
    vehicles: { label: 'Vehicles', kind: 'int', fn: dc('vehicle') },
    activeVehicles: { label: 'Active vehicles', kind: 'int', fn: dc('activeVehicle'), goodWhen: 'up', hint: 'Distinct vehicles that ran at least one trip in the period.' },
    idleVehicles: { label: 'Idle vehicles', kind: 'int', fn: (s) => dc('vehicle')(s) - dc('activeVehicle')(s), goodWhen: 'down', hint: 'Vehicles in service that ran no trip in the period.' },
    underused: {
      label: 'Under-utilised', kind: 'int', goodWhen: 'down', hint: 'Vehicles below 30% utilisation.',
      fn: (s) => {
        const per = new Map<string, { a: number; b: number }>()
        for (const f of s.facts) {
          const x = per.get(f.d.vehicle!) ?? { a: 0, b: 0 }
          x.a += f.m.activeDays ?? 0
          x.b += f.m.availDays ?? 0
          per.set(f.d.vehicle!, x)
        }
        let n = 0
        for (const x of per.values()) if (x.b > 0 && (x.a / x.b) * 100 < 30) n++
        return n
      },
    },
  },
  attrs: {
    vstatus: { label: 'Status', kind: 'text', status: 'vehicle', dims: ['vehicle'], size: 120, fn: (k, _d, x) => x.ds.vehicleById.get(k)?.status ?? null },
  },
  columns: [{ key: 'util', bar: true, size: 150 }, 'vstatus', 'vehicles', 'activeDays', 'availDays', 'trips', 'tripsPerActive', 'km', 'kmPerActive', 'hours', 'hoursUtil', 'downH'],
  kpis: [
    { measure: 'util', icon: Gauge, spark: true },
    { measure: 'activeVehicles', icon: Truck, label: 'Vehicles in use' },
    { measure: 'hours', icon: Clock, spark: true },
    { measure: 'km', icon: Route, spark: true },
    { measure: 'underused', icon: TrendingDown },
    { measure: 'downH', icon: Activity, spark: true },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Utilisation over time', description: 'Share of available vehicle-days with trip activity, with the selected metric alongside', span: 2,
      series: [{ measure: 'util', type: 'area', color: C.green }, { measure: 'activeVehicles', label: 'Vehicles active', type: 'line', axis: 'right', color: C.blue }],
    },
    { id: 'rank', type: 'ranking', title: 'Utilisation ranking' },
    { id: 'share', type: 'share', title: 'Distance by vehicle category', dim: 'category', measure: 'km', centerLabel: 'km driven' },
    {
      id: 'telematics', type: 'custom', span: 2,
      build: (rc, c) => {
        const { ds, window: w } = rc
        const all = ds.all.vehicles.filter((v) => v.status !== 'out_of_service').length || 1
        const frac = ds.vehicles.filter((v) => v.status !== 'out_of_service').length / all
        const buckets = makeBuckets(new Date(w.from), new Date(w.to), c.granularity)
        const sums = buckets.map(() => ({ d: 0, i: 0 }))
        for (const s of ds.dailyStats) {
          const t = Date.parse(s.date)
          const bi = buckets.findIndex((b) => t >= b.start && t < b.end)
          if (bi < 0) continue
          sums[bi]!.d += s.drivingHours * frac
          sums[bi]!.i += s.idleHours * frac
        }
        if (!sums.some((x) => x.d > 0)) return null
        return {
          id: 'telematics', type: 'trend', title: 'Driving vs idle hours (telematics)', description: ds.branchId === 'all' ? 'Fleet-wide engine & GPS hours' : 'Fleet telematics, pro-rated to the selected depot', span: 2,
          data: buckets.map((b, i) => ({ label: b.label, title: b.title, s0: Math.round(sums[i]!.d), s1: Math.round(sums[i]!.i) })),
          series: [
            { key: 's0', label: 'Driving hours', type: 'bar', axis: 'left', color: C.green, kind: 'hours' },
            { key: 's1', label: 'Idle hours', type: 'bar', axis: 'left', color: C.amber, kind: 'hours' },
          ],
          stacked: true,
        }
      },
    },
  ],
  facts: (ds, w) => vehicleDayFacts(ds, w).map((f) => ({ ...f, d: { ...f.d, activeVehicle: (f.m.activeDays ?? 0) > 0 ? f.d.vehicle! : '' } })),
  sort: (g, m) => (g === 'period' ? { id: '__group', desc: false } : { id: m, desc: !(m === 'util' || m === 'hoursUtil') }),
  definitions: [
    'A vehicle-day is “active” when the vehicle started at least one completed, in-transit or delayed trip that day.',
    'Available days exclude workshop downtime from work orders; vehicles that are out of service are not counted.',
    `Time utilisation compares driving hours with a ${OPERATING_HOURS}-hour operating window per available day.`,
    'Under-utilised vehicles are those below 30% utilisation in the period.',
  ],
}

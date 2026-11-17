import { Banknote, Fuel, Gauge, Percent, Route, Wallet } from 'lucide-react'
import { completedTripFacts, costFacts, DIM_BRANCH, DIM_CATEGORY, DIM_VEHICLE, PERIOD_DIM, vehicleDayFacts } from './common'
import { C, dc, rt, sm } from './dsl'
import { economics, vehicleStatusAttr } from './shared'
import type { ReportSpec } from './types'

export const vehiclePerformance: ReportSpec = {
  slug: 'vehicle-performance',
  dims: [DIM_VEHICLE, DIM_CATEGORY, DIM_BRANCH, PERIOD_DIM],
  defaultGroup: 'vehicle',
  fallbackDim: 'vehicle',
  metrics: ['margin', 'revenue', 'totalCost', 'costPerKm', 'km', 'availability'],
  defaultMetric: 'margin',
  distinct: ['vehicle'],
  measures: {
    ...economics,
    availability: {
      label: 'Availability', kind: 'pct1', goodWhen: 'up', tone: { good: 96, warn: 90 }, hint: '100% minus workshop downtime over the period.',
      fn: (s) => {
        const a = s.m.availDays ?? 0
        const d = (s.m.downH ?? 0) / 24
        return a + d > 0 ? (a / (a + d)) * 100 : null
      },
    },
    downH: { label: 'Downtime', kind: 'hours', fn: sm('downH'), goodWhen: 'down' },
    incidents: { label: 'Incidents', kind: 'int', fn: sm('incidents'), goodWhen: 'down' },
    revPerTrip: { label: 'Revenue / trip', kind: 'usd', fn: rt('revenue', 'completed'), goodWhen: 'up' },
    vehicles: { label: 'Vehicles', kind: 'int', fn: dc('vehicle') },
  },
  attrs: { vstatus: vehicleStatusAttr },
  columns: ['vstatus', 'trips', 'km', { key: 'revenue', bar: true, size: 140 }, 'fuelCost', 'maintCost', 'otherCost', 'totalCost', 'margin', 'marginPct', 'costPerKm', 'revPerKm', 'availability', 'l100', 'incidents'],
  kpis: [
    { measure: 'revenue', icon: Banknote, spark: true },
    { measure: 'totalCost', icon: Wallet, spark: true },
    { measure: 'marginPct', icon: Percent, spark: true },
    { measure: 'costPerKm', icon: Route, spark: true },
    { measure: 'availability', icon: Gauge },
    { measure: 'l100', icon: Fuel, label: 'Fuel efficiency' },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Revenue vs operating cost', description: 'Per period, with gross margin % on the right axis', span: 2,
      series: [{ measure: 'revenue', type: 'bar', color: C.green }, { measure: 'totalCost', type: 'bar', color: C.amber }, { measure: 'marginPct', type: 'line', axis: 'right', color: C.blue }],
    },
    { id: 'rank', type: 'ranking', title: 'Vehicle ranking' },
    { id: 'share', type: 'share', title: 'Where the money goes', slices: [{ measure: 'fuelCost', label: 'Fuel', color: C.green }, { measure: 'maintCost', label: 'Maintenance', color: C.blue }, { measure: 'otherCost', label: 'Other costs', color: C.amber }], centerLabel: 'operating cost' },
    {
      id: 'unit', type: 'trend', title: 'Unit economics', description: 'Revenue and cost per km driven', span: 2,
      series: [{ measure: 'revPerKm', type: 'line', color: C.green }, { measure: 'costPerKm', type: 'line', color: C.red }],
    },
  ],
  facts: (ds, w) => [
    ...completedTripFacts(ds, w),
    ...costFacts(ds, w),
    ...vehicleDayFacts(ds, w).map((f) => ({ t: f.t, d: f.d, m: { availDays: f.m.availDays!, downH: f.m.downH! } })),
    ...ds.incidents.filter((i) => Date.parse(i.date) >= w.from && Date.parse(i.date) <= w.to).map((i) => ({
      t: Date.parse(i.date),
      d: { vehicle: i.vehicleId, category: ds.vehicleById.get(i.vehicleId)?.category ?? '', branch: i.branchId, driver: i.driverId ?? '' },
      m: { incidents: 1 },
    })),
  ],
  definitions: [
    'Revenue is recognised when a trip completes. Operating cost = fuel (card + cash claims) + maintenance (work orders, tyres) + other claims linked to the vehicle.',
    'Fleet-level costs with no vehicle (e.g. insurance premiums) appear under “Unallocated” and in depot / period views.',
    'Availability is 100% minus workshop downtime from work orders; vehicles that are out of service are excluded.',
    'Fuel efficiency is litres purchased divided by km driven in the same period.',
  ],
}

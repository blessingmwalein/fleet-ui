import { VEHICLE_STATUS } from '@/config/status'
import { rt, sm } from './dsl'
import type { AttrDef, MeasureDef, Sums } from './types'

const totalCost = (s: Sums) => (s.m.fuelCost ?? 0) + (s.m.maintCost ?? 0) + (s.m.otherCost ?? 0)
const margin = (s: Sums) => (s.m.revenue ?? 0) - totalCost(s)

/** Measures shared by the vehicle and financial reports (facts: trips + `costFacts`). */
export const economics: Record<string, MeasureDef> = {
  revenue: { label: 'Revenue', kind: 'usd', fn: sm('revenue'), goodWhen: 'up', hint: 'Revenue of trips completed in the period.' },
  trips: { label: 'Trips', kind: 'int', fn: sm('completed'), goodWhen: 'up', hint: 'Completed trips.' },
  km: { label: 'Distance', kind: 'km', fn: sm('km'), goodWhen: 'up' },
  fuelCost: { label: 'Fuel', kind: 'usd', fn: sm('fuelCost'), goodWhen: 'down', hint: 'Fuel card transactions plus cash fuel claims.' },
  maintCost: { label: 'Maintenance', kind: 'usd', fn: sm('maintCost'), goodWhen: 'down', hint: 'Completed / in-progress work orders and tyre purchases.' },
  otherCost: { label: 'Other costs', kind: 'usd', fn: sm('otherCost'), goodWhen: 'down', hint: 'Allowances, tolls, insurance, licensing, fines and other claims.' },
  totalCost: { label: 'Operating cost', kind: 'usd', fn: totalCost, goodWhen: 'down' },
  margin: { label: 'Gross margin', kind: 'usd', fn: margin, goodWhen: 'up', hint: 'Revenue minus fuel, maintenance and other operating costs.' },
  marginPct: { label: 'Margin %', kind: 'pct1', fn: (s) => ((s.m.revenue ?? 0) > 0 ? (margin(s) / (s.m.revenue ?? 1)) * 100 : null), goodWhen: 'up', tone: { good: 20, warn: 0 } },
  costPerKm: { label: 'Cost / km', kind: 'usd2', fn: (s) => ((s.m.km ?? 0) > 0 ? totalCost(s) / (s.m.km ?? 1) : null), goodWhen: 'down' },
  revPerKm: { label: 'Revenue / km', kind: 'usd2', fn: rt('revenue', 'km'), goodWhen: 'up' },
  l100: { label: 'L / 100 km', kind: 'num1', fn: rt('litres', 'km', 100), goodWhen: 'down', hint: 'Litres purchased ÷ distance driven × 100.' },
}

export const vehicleStatusAttr: AttrDef = {
  label: 'Status', kind: 'text', status: 'vehicle', dims: ['vehicle'], size: 120,
  fn: (k, _d, x) => x.ds.vehicleById.get(k)?.status ?? null,
}
export const vehicleStatusLabel = (s: string) => VEHICLE_STATUS[s as keyof typeof VEHICLE_STATUS]?.label ?? s

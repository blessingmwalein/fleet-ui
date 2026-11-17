import { CalendarClock, ClipboardList, Hammer, Timer, Wallet, Wrench } from 'lucide-react'
import { WORKORDER_TYPE, PRIORITY } from '@/config/status'
import { completedTripFacts, DIM_BRANCH, DIM_CATEGORY, DIM_VEHICLE, inWin, isReactive, PERIOD_DIM, vehicleDims, woCost, woDowntimeH, woTime } from './common'
import { C, rt, sm } from './dsl'
import type { DimDef, Fact, ReportRow, ReportSpec, TableSpec } from './types'
import { fmtDateLite } from './text'

const DIM_TYPE: DimDef = { value: 'type', label: 'Work order type', resolve: (_ds, k) => ({ label: WORKORDER_TYPE[k as keyof typeof WORKORDER_TYPE] ?? k }) }
const DIM_PROVIDER: DimDef = {
  value: 'provider', label: 'Service provider',
  resolve: (ds, k) => { const p = ds.providerById.get(k); return p ? { label: p.name, sub: `${p.type === 'internal' ? 'Internal' : 'External'} · ${p.city}` } : { label: 'Unknown' } },
}
const DIM_PRIORITY: DimDef = { value: 'priority', label: 'Priority', resolve: (_ds, k) => ({ label: PRIORITY[k]?.label ?? k }) }

export const maintenanceCosts: ReportSpec = {
  slug: 'maintenance-costs',
  dims: [DIM_VEHICLE, DIM_TYPE, DIM_PROVIDER, DIM_BRANCH, DIM_CATEGORY, DIM_PRIORITY, PERIOD_DIM],
  defaultGroup: 'vehicle',
  fallbackDim: 'vehicle',
  metrics: ['cost', 'wo', 'downH', 'avgCost', 'costPerKm', 'preventivePct'],
  defaultMetric: 'cost',
  measures: {
    wo: { label: 'Work orders', kind: 'int', fn: sm('wo'), hint: 'Completed and in-progress work orders in the period.' },
    labour: { label: 'Labour', kind: 'usd', fn: sm('labour'), goodWhen: 'down' },
    parts: { label: 'Parts', kind: 'usd', fn: sm('parts'), goodWhen: 'down' },
    cost: { label: 'Total cost', kind: 'usd', fn: sm('cost'), goodWhen: 'down' },
    avgCost: { label: 'Avg cost / WO', kind: 'usd', fn: rt('cost', 'wo'), goodWhen: 'down' },
    downH: { label: 'Downtime', kind: 'hours', fn: sm('downH'), goodWhen: 'down', hint: 'Hours vehicles were off the road for these work orders.' },
    avgDown: { label: 'Avg downtime / WO', kind: 'hours', fn: rt('downH', 'wo'), goodWhen: 'down' },
    km: { label: 'Distance', kind: 'km', fn: sm('km') },
    costPerKm: { label: 'Cost / km', kind: 'usd2', fn: (s) => ((s.m.km ?? 0) > 0 && (s.m.cost ?? 0) > 0 ? (s.m.cost ?? 0) / (s.m.km ?? 1) : null), goodWhen: 'down' },
    preventivePct: { label: 'Preventive %', kind: 'pct1', fn: rt('preventive', 'wo', 100), goodWhen: 'up', tone: { good: 50, warn: 30 }, hint: 'Share of work orders that are planned preventive maintenance.' },
    reactiveCost: { label: 'Reactive cost', kind: 'usd', fn: sm('reactiveCost'), goodWhen: 'down', hint: 'Corrective, breakdown and accident-repair spend.' },
    partsPct: { label: 'Parts share', kind: 'pct1', fn: rt('parts', 'cost', 100) },
  },
  attrs: {
    vcat: { label: 'Category', kind: 'text', dims: ['vehicle'], size: 120, fn: (k, _d, x) => x.ds.vehicleById.get(k)?.category.replace(/_/g, ' ') ?? null },
    prating: { label: 'Rating', kind: 'num1', dims: ['provider'], size: 80, fn: (k, _d, x) => x.ds.providerById.get(k)?.rating ?? null },
  },
  columns: ['vcat', 'prating', 'wo', { key: 'cost', bar: true, size: 140 }, 'labour', 'parts', 'partsPct', 'avgCost', 'downH', 'avgDown', 'preventivePct', 'reactiveCost', 'km', 'costPerKm'],
  kpis: [
    { measure: 'cost', icon: Wallet, label: 'Maintenance cost', spark: true },
    { measure: 'wo', icon: ClipboardList, spark: true },
    { measure: 'avgCost', icon: Wrench },
    { measure: 'downH', icon: Timer, label: 'Downtime', spark: true },
    { measure: 'preventivePct', icon: Hammer, label: 'Preventive share' },
    {
      key: 'overdue', label: 'Overdue services', kind: 'int', icon: CalendarClock, goodWhen: 'down', hint: 'Service schedules whose due date has passed.',
      custom: ({ ds, window: w }) => ds.schedules.filter((s) => Date.parse(s.nextDueDate) < Math.min(w.to, ds.now)).length,
    },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Maintenance spend', description: 'Labour and parts per period; work-order count on the right axis', span: 2, stacked: true,
      series: [{ measure: 'labour', type: 'bar', color: C.blue }, { measure: 'parts', type: 'bar', color: C.amber }, { measure: 'wo', type: 'line', axis: 'right', color: C.green }],
    },
    { id: 'rank', type: 'ranking', title: 'Maintenance ranking' },
    { id: 'share', type: 'share', title: 'Spend by service provider', dim: 'provider', measure: 'cost', centerLabel: 'maintenance spend' },
    { id: 'bytype', type: 'trendBy', title: 'Spend by work-order type over time', dim: 'type', measure: 'cost', span: 2 },
  ],
  facts: (ds, w) => {
    const out: Fact[] = []
    for (const wo of ds.workOrders) {
      const t = woTime(wo)
      if (t === null || Number.isNaN(t) || !inWin(t, w)) continue
      const cost = woCost(wo)
      out.push({
        t,
        d: { ...vehicleDims(ds, wo.vehicleId), branch: wo.branchId, type: wo.type, provider: wo.providerId, priority: wo.priority },
        m: { wo: 1, labour: wo.labourCostUsd, parts: wo.partsCostUsd, cost, downH: woDowntimeH(wo, ds.now), preventive: wo.type === 'preventive' ? 1 : 0, reactiveCost: isReactive(wo.type) ? cost : 0 },
      })
    }
    for (const f of completedTripFacts(ds, w)) out.push({ t: f.t, d: { vehicle: f.d.vehicle!, category: f.d.category!, branch: f.d.branch! }, m: { km: f.m.km! } })
    return out
  },
  keepRow: (s, key, g) => (g === 'vehicle' || g === 'category' ? (s.m.wo ?? 0) > 0 || (s.m.km ?? 0) > 0 : true) && (g === 'provider' || g === 'type' ? !!key : true),
  details: ({ ds, window: w }) => {
    const rows: ReportRow[] = ds.workOrders
      .filter((wo) => { const t = woTime(wo); return t !== null && inWin(t, w) })
      .sort((a, b) => woCost(b) - woCost(a))
      .slice(0, 12)
      .map((wo) => ({
        id: wo.id,
        label: wo.woNo,
        entity: { type: 'workorder' as const, id: wo.id },
        v: {
          vehicle: ds.vehicleById.get(wo.vehicleId)?.reg ?? '—', title: wo.title, type: WORKORDER_TYPE[wo.type], provider: ds.providerById.get(wo.providerId)?.name ?? '—',
          date: fmtDateLite(wo.completedAt ?? wo.startedAt ?? wo.scheduledDate), labour: wo.labourCostUsd, parts: wo.partsCostUsd, total: woCost(wo), downtime: woDowntimeH(wo, ds.now),
        },
      }))
    const t: TableSpec = {
      id: 'topwo', title: 'Highest-cost work orders', description: 'Top 12 work orders in the period by total cost', groupLabel: 'Work order', clickable: true,
      columns: [
        { key: 'vehicle', label: 'Vehicle', kind: 'text', size: 100 }, { key: 'title', label: 'Job', kind: 'text', size: 230 }, { key: 'type', label: 'Type', kind: 'text', size: 120, hideBelow: 'md' },
        { key: 'provider', label: 'Provider', kind: 'text', size: 200, hideBelow: 'lg' }, { key: 'date', label: 'Date', kind: 'text', size: 110 },
        { key: 'labour', label: 'Labour', kind: 'usd', size: 90 }, { key: 'parts', label: 'Parts', kind: 'usd', size: 90 }, { key: 'total', label: 'Total', kind: 'usd', size: 90 }, { key: 'downtime', label: 'Downtime', kind: 'hours', size: 100 },
      ],
      rows,
      defaultSort: { id: 'total', desc: true },
    }
    return rows.length ? [t] : []
  },
  definitions: [
    'Includes work orders that were completed (or are in progress) in the period; requested, approved and scheduled orders carry no cost yet.',
    'Preventive share = preventive work orders ÷ all work orders. Reactive cost = corrective, breakdown and accident repairs.',
    'Downtime is the time the vehicle was off the road for the job; cost per km uses km driven on completed trips in the same period.',
    'Overdue services counts service-schedule tasks whose due date has passed (as at the end of the period).',
  ],
}

import { Camera, Clock3, PackageCheck, PackageX, ThumbsUp, Timer } from 'lucide-react'
import { DIM_BRANCH, DIM_CARGO, DIM_CUSTOMER, DIM_DEST, DIM_ROUTE, inWin, PERIOD_DIM, ts, tripFact } from './common'
import { C, rt, sm } from './dsl'
import type { DimDef, Fact, ReportRow, ReportSpec, TableSpec } from './types'
import { fmtDateTimeLite } from './text'

const DIM_EXTYPE: DimDef = { value: 'exType', label: 'Exception type', resolve: (_ds, k) => ({ label: k || 'None' }) }

export const deliveryPerformance: ReportSpec = {
  slug: 'delivery-performance',
  dims: [DIM_CUSTOMER, DIM_BRANCH, DIM_DEST, DIM_CARGO, DIM_ROUTE, DIM_EXTYPE, PERIOD_DIM],
  defaultGroup: 'customer',
  fallbackDim: 'customer',
  metrics: ['deliveries', 'onTime', 'exceptions', 'cleanPct', 'avgDelay', 'revenue'],
  defaultMetric: 'deliveries',
  distinct: ['customer'],
  measures: {
    deliveries: { label: 'Deliveries', kind: 'int', fn: sm('completed'), goodWhen: 'up', hint: 'Completed customer trips (proof of delivery captured).' },
    customers: { label: 'Customers served', kind: 'int', fn: (s) => s.sets.customer?.size ?? 0 },
    onTime: { label: 'On-time %', kind: 'pct1', fn: rt('onTime', 'completed', 100), goodWhen: 'up', tone: { good: 85, warn: 70 }, hint: 'Deliveries arriving within 15 min of the planned time.' },
    late: { label: 'Late', kind: 'int', fn: sm('late'), goodWhen: 'down' },
    avgDelay: { label: 'Avg delay (late)', kind: 'minutes', fn: rt('delayMin', 'late'), goodWhen: 'down' },
    podPct: { label: 'POD captured', kind: 'pct1', fn: rt('pod', 'completed', 100), goodWhen: 'up', tone: { good: 98, warn: 90 }, hint: 'Deliveries with a signed proof of delivery.' },
    cleanPct: { label: 'Good condition', kind: 'pct1', fn: rt('clean', 'pod', 100), goodWhen: 'up', tone: { good: 95, warn: 90 }, hint: 'Signed PODs recorded as “goods received in good condition”.' },
    exceptions: { label: 'Exceptions', kind: 'int', fn: sm('exceptions'), goodWhen: 'down', hint: 'Shipment exceptions raised in the period (damage, short delivery, customer unavailable…).' },
    openExc: { label: 'Open exceptions', kind: 'int', fn: sm('openExc'), goodWhen: 'down' },
    excRate: { label: 'Exceptions / 100', kind: 'num1', fn: rt('exceptions', 'completed', 100), goodWhen: 'down', tone: { good: 4, warn: 8, invert: true } },
    tonnes: { label: 'Tonnes', kind: 'num1', fn: (s) => (s.m.weight ?? 0) / 1000 },
    revenue: { label: 'Revenue', kind: 'usd', fn: sm('revenue'), goodWhen: 'up' },
    revPerDelivery: { label: 'Revenue / delivery', kind: 'usd', fn: rt('revenue', 'completed'), goodWhen: 'up' },
  },
  attrs: {
    ccity: { label: 'City', kind: 'text', dims: ['customer'], size: 110, fn: (k, _d, x) => x.ds.customerById.get(k)?.city ?? null },
    cterms: { label: 'Terms', kind: 'text', dims: ['customer'], size: 80, fn: (k, _d, x) => { const c = x.ds.customerById.get(k); return c ? `${c.paymentTermsDays} d` : null } },
  },
  columns: ['ccity', { key: 'deliveries', bar: true, size: 130 }, 'tonnes', 'onTime', 'late', 'avgDelay', 'podPct', 'cleanPct', 'exceptions', 'openExc', 'excRate', 'revenue', 'revPerDelivery'],
  kpis: [
    { measure: 'deliveries', icon: PackageCheck, spark: true },
    { measure: 'onTime', icon: Timer, label: 'On-time delivery', spark: true },
    { measure: 'podPct', icon: Camera },
    { measure: 'cleanPct', icon: ThumbsUp },
    { measure: 'exceptions', icon: PackageX, spark: true },
    { measure: 'avgDelay', icon: Clock3 },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Deliveries and on-time %', description: 'Completed deliveries per period with on-time % on the right axis', span: 2,
      series: [{ measure: 'deliveries', type: 'bar', color: C.green }, { measure: 'onTime', type: 'line', axis: 'right', color: C.blue }],
    },
    { id: 'rank', type: 'ranking', title: 'Customer ranking' },
    { id: 'share', type: 'share', title: 'Exceptions by type', dim: 'exType', measure: 'exceptions', centerLabel: 'exceptions' },
    {
      id: 'late', type: 'trend', title: 'Late deliveries and exceptions', description: 'Service failures per period', span: 2,
      series: [{ measure: 'late', type: 'bar', color: C.amber }, { measure: 'exceptions', type: 'bar', color: C.red }],
    },
  ],
  facts: (ds, w) => {
    const out: Fact[] = []
    for (const t of ds.trips) {
      if (t.status !== 'completed' || !t.actualEnd || !t.customerId || t.cargoType === 'passengers') continue
      const at = Date.parse(t.actualEnd)
      if (!inWin(at, w)) continue
      const f = tripFact(ds, t, at)
      f.m.pod = t.pod ? 1 : 0
      f.m.clean = t.pod?.conditionOk ? 1 : 0
      out.push(f)
    }
    for (const s of ds.shipments) {
      if (!s.exception) continue
      const t = ts(s.exception.raisedAt)
      if (!inWin(t, w)) continue
      const trip = s.tripId ? ds.tripById.get(s.tripId) : undefined
      out.push({
        t,
        d: { customer: s.customerId, branch: s.branchId, destCity: s.delivery.city, cargo: s.cargoType, route: trip?.routeId ?? '', exType: s.exception.type, vehicle: s.vehicleId ?? '', driver: s.driverId ?? '' },
        m: { exceptions: 1, openExc: s.exception.resolved ? 0 : 1 },
      })
    }
    return out
  },
  details: ({ ds, window: w }) => {
    const rows: ReportRow[] = ds.shipments
      .filter((s) => s.exception && inWin(ts(s.exception.raisedAt), w))
      .sort((a, b) => b.exception!.raisedAt.localeCompare(a.exception!.raisedAt))
      .map((s) => ({
        id: s.id,
        label: s.trackingRef,
        entity: { type: 'shipment' as const, id: s.id },
        v: {
          customer: ds.customerById.get(s.customerId)?.name ?? '—',
          type: s.exception!.type,
          raised: fmtDateTimeLite(s.exception!.raisedAt),
          status: s.exception!.resolved ? 'Resolved' : 'Open',
          detail: s.exception!.description,
        },
      }))
    const t: TableSpec = {
      id: 'exceptions', title: 'Exception register', description: 'Shipments with a recorded delivery exception in the period', groupLabel: 'Shipment', clickable: true,
      columns: [
        { key: 'customer', label: 'Customer', kind: 'text', size: 180 }, { key: 'type', label: 'Exception', kind: 'text', size: 180 }, { key: 'raised', label: 'Raised', kind: 'text', size: 140 },
        { key: 'status', label: 'Status', kind: 'text', size: 90 }, { key: 'detail', label: 'Detail', kind: 'text', size: 380, hideBelow: 'lg' },
      ],
      rows,
      defaultSort: { id: 'raised', desc: true },
    }
    return rows.length ? [t] : []
  },
  definitions: [
    'A delivery is a completed customer trip (excluding passenger services) whose arrival fell in the period; on-time means within 15 minutes of plan.',
    'POD captured and good-condition rates come from the signed proof of delivery recorded at hand-over.',
    'Exceptions are shipment exceptions raised in the period (damaged goods, short delivery, customer unavailable, border holds…).',
  ],
}

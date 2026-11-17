import { CalendarDays, Hourglass, Layers, Receipt, Route, Wallet } from 'lucide-react'
import { EXPENSE_STATUS } from '@/config/status'
import { completedTripFacts, DIM_BRANCH, DIM_DRIVER, DIM_VEHICLE, inWin, PERIOD_DIM, ts, vehicleDims, woCost, woTime } from './common'
import { C, rt, sm } from './dsl'
import { fmtDateLite } from './text'
import type { DimDef, Fact, ReportRow, ReportSpec, TableSpec } from './types'

const BUDGET_CATS = ['fuel', 'maintenance', 'toll', 'allowance', 'insurance', 'tyres']
const bucket = (c: string) => (BUDGET_CATS.includes(c) ? c : 'other')
const CAT_LABEL: Record<string, string> = {
  fuel: 'Fuel', maintenance: 'Maintenance', toll: 'Tolls', allowance: 'Driver allowances', insurance: 'Insurance', tyres: 'Tyres', other: 'Other (parking, fines, licensing…)',
}
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', fuel_card: 'Fuel card', bank_transfer: 'Bank transfer', ecocash: 'EcoCash', card: 'Card', workshop: 'Workshop account' }
const SOURCE_LABEL: Record<string, string> = { claims: 'Expense claims', fuel: 'Fuel transactions', workshop: 'Workshop (work orders)' }

const DIM_CAT: DimDef = { value: 'category', label: 'Category', resolve: (_ds, k) => ({ label: CAT_LABEL[k] ?? k }) }
const DIM_SUPPLIER: DimDef = { value: 'supplier', label: 'Supplier', resolve: (_ds, k) => ({ label: k || 'Unknown' }) }
const DIM_METHOD: DimDef = { value: 'method', label: 'Payment method', resolve: (_ds, k) => ({ label: METHOD_LABEL[k] ?? k }) }
const DIM_STATUS: DimDef = { value: 'status', label: 'Approval status', resolve: (_ds, k) => ({ label: EXPENSE_STATUS[k]?.label ?? k }) }
const DIM_SOURCE: DimDef = { value: 'source', label: 'Cost source', resolve: (_ds, k) => ({ label: SOURCE_LABEL[k] ?? k }) }

/** Pro-rated budget for a category over a window (company-wide budgets only). */
function budgetFor(budgets: { period: string; category: string; branchId: string; budgetUsd: number }[], cat: string, from: number, to: number): number | null {
  let total = 0
  let found = false
  for (const b of budgets) {
    if (b.category !== cat || b.branchId !== 'all') continue
    const [y, m] = b.period.split('-').map(Number) as [number, number]
    const ms = new Date(y, m - 1, 1).getTime()
    const me = new Date(y, m, 1).getTime()
    const overlap = Math.min(to, me) - Math.max(from, ms)
    if (overlap <= 0) continue
    total += b.budgetUsd * (overlap / (me - ms))
    found = true
  }
  return found ? total : null
}

export const operatingExpenses: ReportSpec = {
  slug: 'operating-expenses',
  dims: [DIM_CAT, DIM_BRANCH, DIM_VEHICLE, DIM_DRIVER, DIM_SUPPLIER, DIM_METHOD, DIM_STATUS, DIM_SOURCE, PERIOD_DIM],
  defaultGroup: 'category',
  fallbackDim: 'category',
  metrics: ['amount', 'n', 'avg', 'costPerKm'],
  defaultMetric: 'amount',
  toggles: [
    { key: 'claims', label: 'Expense claims', default: true },
    { key: 'fuel', label: 'Fuel transactions', default: true },
    { key: 'workshop', label: 'Workshop', default: true },
  ],
  measures: {
    amount: { label: 'Spend', kind: 'usd', fn: sm('amount'), goodWhen: 'down' },
    n: { label: 'Transactions', kind: 'int', fn: sm('n') },
    avg: { label: 'Avg per transaction', kind: 'usd2', fn: rt('amount', 'n') },
    perDay: { label: 'Spend / day', kind: 'usd', fn: (s, x) => (s.m.amount ?? 0) / x.days, goodWhen: 'down' },
    km: { label: 'Distance', kind: 'km', fn: sm('km') },
    costPerKm: { label: 'Cost / km', kind: 'usd2', fn: (s) => ((s.m.km ?? 0) > 0 && (s.m.amount ?? 0) > 0 ? (s.m.amount ?? 0) / (s.m.km ?? 1) : null), goodWhen: 'down', hint: 'Spend ÷ km driven on completed trips (meaningful for vehicle, depot and period views).' },
    pending: { label: 'Awaiting approval', kind: 'usd', fn: sm('pending'), hint: 'Expense claims still pending approval.' },
  },
  attrs: {
    budget: {
      label: 'Budget', kind: 'usd', dims: ['category'], size: 100,
      fn: (k, _d, x) => (x.ds.branchId === 'all' ? budgetFor(x.ds.all.budgets, k, x.window.from, x.window.to) : null),
    },
    used: {
      label: 'Budget used', kind: 'pct', dims: ['category'], size: 110, tone: { good: 100, warn: 115, invert: true },
      fn: (k, _d, x) => { const b = x.ds.branchId === 'all' ? budgetFor(x.ds.all.budgets, k, x.window.from, x.window.to) : null; return b && b > 0 ? Math.round(((x.s.m.amount ?? 0) / b) * 100) : null },
    },
  },
  columns: [{ key: 'amount', bar: true, size: 140 }, 'n', 'avg', 'perDay', 'budget', 'used', 'pending', 'km', 'costPerKm'],
  kpis: [
    { measure: 'amount', icon: Wallet, label: 'Operating spend', spark: true },
    { measure: 'perDay', icon: CalendarDays, spark: true },
    { measure: 'costPerKm', icon: Route, spark: true },
    {
      key: 'top', label: 'Largest category', kind: 'text', icon: Layers, hint: 'Category with the highest spend and its share of the total.',
      custom: ({ total }) => {
        const by = new Map<string, number>()
        for (const f of total.facts) if (f.m.amount) by.set(f.d.category!, (by.get(f.d.category!) ?? 0) + f.m.amount)
        const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0]
        const sum = [...by.values()].reduce((s, x) => s + x, 0)
        return top ? `${(CAT_LABEL[top[0]] ?? top[0]).split(' (')[0]} · ${Math.round((top[1] / sum) * 100)}%` : '—'
      },
    },
    { measure: 'n', icon: Receipt },
    { measure: 'pending', icon: Hourglass, goodWhen: 'down' },
  ],
  charts: [
    { id: 'bycat', type: 'trendBy', title: 'Spend by category over time', description: 'Stacked per period', dim: 'category', measure: 'amount', limit: 6, span: 2 },
    { id: 'rank', type: 'ranking', title: 'Spend ranking' },
    { id: 'share', type: 'share', title: 'Spend by category', dim: 'category', measure: 'amount', centerLabel: 'operating spend', limit: 7 },
    {
      id: 'unit', type: 'trend', title: 'Spend and cost per km', description: 'Total spend per period with cost per km on the right axis', span: 2,
      series: [{ measure: 'amount', type: 'area', color: C.green }, { measure: 'costPerKm', type: 'line', axis: 'right', color: C.amber }],
    },
  ],
  facts: (ds, w, tg) => {
    const out: Fact[] = []
    if (tg.claims !== false)
      for (const e of ds.expenses) {
        if (e.status === 'rejected') continue
        const t = ts(e.date)
        if (!inWin(t, w)) continue
        out.push({
          t,
          d: { ...vehicleDims(ds, e.vehicleId), category: bucket(e.category), branch: e.branchId, driver: e.driverId ?? '', supplier: e.supplier, method: e.paymentMethod, status: e.status, source: 'claims' },
          m: { amount: e.amountUsd, n: 1, pending: e.status === 'pending' ? e.amountUsd : 0 },
        })
      }
    if (tg.fuel !== false)
      for (const f of ds.fuel) {
        const t = ts(f.date)
        if (!inWin(t, w)) continue
        out.push({
          t,
          d: { ...vehicleDims(ds, f.vehicleId), category: 'fuel', branch: f.branchId, driver: f.driverId ?? '', supplier: ds.stationById.get(f.stationId)?.brand ?? 'Fuel station', method: 'fuel_card', status: 'paid', source: 'fuel' },
          m: { amount: f.totalUsd, n: 1 },
        })
      }
    if (tg.workshop !== false)
      for (const wo of ds.workOrders) {
        const t = woTime(wo)
        if (t === null || Number.isNaN(t) || !inWin(t, w)) continue
        out.push({
          t,
          d: { ...vehicleDims(ds, wo.vehicleId), category: 'maintenance', branch: wo.branchId, driver: '', supplier: ds.providerById.get(wo.providerId)?.name ?? 'Workshop', method: 'workshop', status: wo.status === 'completed' ? 'paid' : 'approved', source: 'workshop' },
          m: { amount: woCost(wo), n: 1 },
        })
      }
    for (const f of completedTripFacts(ds, w)) out.push({ t: f.t, d: { vehicle: f.d.vehicle!, category: '', branch: f.d.branch!, driver: f.d.driver! }, m: { km: f.m.km! } })
    return out
  },
  keepRow: (s) => (s.m.amount ?? 0) > 0,
  details: ({ ds, window: w, toggles }) => {
    if (toggles.claims === false) return []
    const rows: ReportRow[] = ds.expenses
      .filter((e) => e.status !== 'rejected' && inWin(ts(e.date), w))
      .sort((a, b) => b.amountUsd - a.amountUsd)
      .slice(0, 12)
      .map((e) => ({
        id: e.id,
        label: e.ref,
        entity: { type: 'expense' as const, id: e.id },
        v: { date: fmtDateLite(e.date), category: CAT_LABEL[bucket(e.category)]?.split(' (')[0] ?? e.category, description: e.description, supplier: e.supplier, vehicle: e.vehicleId ? (ds.vehicleById.get(e.vehicleId)?.reg ?? '—') : '—', amount: e.amountUsd, status: EXPENSE_STATUS[e.status]?.label ?? e.status },
      }))
    const t: TableSpec = {
      id: 'largest', title: 'Largest expense claims', description: 'Top 12 individual claims in the period (excluding rejected)', groupLabel: 'Claim', clickable: true,
      columns: [
        { key: 'date', label: 'Date', kind: 'text', size: 110 }, { key: 'category', label: 'Category', kind: 'text', size: 130 }, { key: 'description', label: 'Description', kind: 'text', size: 330, hideBelow: 'md' },
        { key: 'supplier', label: 'Supplier', kind: 'text', size: 170, hideBelow: 'lg' }, { key: 'vehicle', label: 'Vehicle', kind: 'text', size: 100, hideBelow: 'lg' }, { key: 'amount', label: 'Amount', kind: 'usd2', size: 100 }, { key: 'status', label: 'Status', kind: 'text', size: 90 },
      ],
      rows,
      defaultSort: { id: 'amount', desc: true },
    }
    return rows.length ? [t] : []
  },
  definitions: [
    'Operating spend combines expense claims (allowances, tolls, insurance, licensing, tyres…), fuel-card transactions and workshop work-order costs; use the source toggles to focus on one.',
    'Rejected claims are excluded. Awaiting approval shows pending claims still included in the totals.',
    'Budgets are company-wide monthly budgets pro-rated to the selected period; they appear for the category view when the depot filter is “All depots”.',
    'Cost per km divides spend by km driven on completed trips in the same period.',
  ],
}

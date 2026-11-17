import { addDays, addMonths, differenceInCalendarDays, endOfDay, endOfMonth, format, startOfMonth } from 'date-fns'
import type { Budget, Expense, ExpenseCategory, FuelTransaction, Invoice, Trip, Vehicle, VehicleCategory, WorkOrder } from '@/types'
import { sumByBucket, type Bucket } from '@/lib/analytics'

/* ------------------------------------------------------------------------------------------------
 * Cost model
 * Operating cost = fuel transactions + completed work orders + non-rejected expense claims.
 * Expense categories are folded into 7 reporting buckets (the same buckets budgets are set against).
 * ---------------------------------------------------------------------------------------------- */
export const COST_CATEGORIES = ['fuel', 'maintenance', 'toll', 'allowance', 'insurance', 'tyres', 'other'] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]

export const COST_LABEL: Record<CostCategory, string> = {
  fuel: 'Fuel', maintenance: 'Maintenance', toll: 'Tolls', allowance: 'Allowances', insurance: 'Insurance', tyres: 'Tyres', other: 'Other',
}
export const COST_COLOR: Record<CostCategory, string> = {
  fuel: 'var(--chart-1)', maintenance: 'var(--chart-2)', toll: 'var(--chart-3)', allowance: 'var(--chart-4)', insurance: 'var(--chart-5)', tyres: 'var(--chart-8)', other: 'var(--chart-7)',
}

export function bucketOf(c: ExpenseCategory): CostCategory {
  return (COST_CATEGORIES as readonly string[]).includes(c) ? (c as CostCategory) : 'other'
}

export type Cats = Record<CostCategory, number>
export const emptyCats = (): Cats => ({ fuel: 0, maintenance: 0, toll: 0, allowance: 0, insurance: 0, tyres: 0, other: 0 })
export const sumCats = (c: Cats) => COST_CATEGORIES.reduce((s, k) => s + c[k], 0)

export interface CostEntry {
  key: string
  source: 'fuel' | 'workorder' | 'expense'
  refId: string
  ref: string
  ts: number
  category: CostCategory
  detail: string
  amountUsd: number
  vehicleId: string | null
  tripId: string | null
  branchId: string
}

export function buildCostEntries(fuel: FuelTransaction[], workOrders: WorkOrder[], expenses: Expense[]): CostEntry[] {
  const out: CostEntry[] = []
  for (const f of fuel) {
    out.push({ key: `f-${f.id}`, source: 'fuel', refId: f.id, ref: f.ref, ts: new Date(f.date).getTime(), category: 'fuel', detail: `${Math.round(f.litres)} L ${f.fuelType} @ ${f.pricePerLitreUsd.toFixed(2)}`, amountUsd: f.totalUsd, vehicleId: f.vehicleId, tripId: f.tripId, branchId: f.branchId })
  }
  for (const w of workOrders) {
    if (w.status !== 'completed' || !w.completedAt) continue
    out.push({ key: `w-${w.id}`, source: 'workorder', refId: w.id, ref: w.woNo, ts: new Date(w.completedAt).getTime(), category: 'maintenance', detail: w.title, amountUsd: w.labourCostUsd + w.partsCostUsd, vehicleId: w.vehicleId, tripId: null, branchId: w.branchId })
  }
  for (const e of expenses) {
    if (e.status === 'rejected') continue
    out.push({ key: `e-${e.id}`, source: 'expense', refId: e.id, ref: e.ref, ts: new Date(e.date).getTime(), category: bucketOf(e.category), detail: e.description, amountUsd: e.amountUsd, vehicleId: e.vehicleId, tripId: e.tripId, branchId: e.branchId })
  }
  return out
}

export function costByCategory(entries: CostEntry[]): Cats {
  const c = emptyCats()
  for (const e of entries) c[e.category] += e.amountUsd
  return c
}
export const sumCost = (entries: CostEntry[]) => entries.reduce((s, e) => s + e.amountUsd, 0)

/* ------------------------------------------------------------------------------------------------
 * Revenue model — completed trips, recognised on delivery date.
 * ---------------------------------------------------------------------------------------------- */
export interface RevenueEntry {
  tripId: string
  ref: string
  ts: number
  revenueUsd: number
  km: number
  vehicleId: string | null
  customerId: string | null
  branchId: string
  origin: string
  destination: string
}

export function buildRevenueEntries(trips: Trip[]): RevenueEntry[] {
  const out: RevenueEntry[] = []
  for (const t of trips) {
    if (t.status !== 'completed' || !t.actualEnd) continue
    out.push({
      tripId: t.id, ref: t.ref, ts: new Date(t.actualEnd).getTime(), revenueUsd: t.revenueUsd, km: t.actualDistanceKm ?? t.plannedDistanceKm,
      vehicleId: t.vehicleId, customerId: t.customerId, branchId: t.branchId, origin: t.origin.city, destination: t.destination.city,
    })
  }
  return out
}

export interface Totals {
  trips: number
  revenue: number
  cost: number
  margin: number
  marginPct: number | null
  km: number
  costPerKm: number | null
  revenuePerKm: number | null
  byCategory: Cats
}

export function totals(rev: RevenueEntry[], costs: CostEntry[]): Totals {
  let revenue = 0
  let km = 0
  for (const r of rev) {
    revenue += r.revenueUsd
    km += r.km
  }
  const byCategory = costByCategory(costs)
  const cost = sumCats(byCategory)
  const margin = revenue - cost
  return {
    trips: rev.length, revenue, cost, margin, marginPct: revenue > 0 ? (margin / revenue) * 100 : null, km,
    costPerKm: km > 0 ? cost / km : null, revenuePerKm: km > 0 ? revenue / km : null, byCategory,
  }
}

export function trendRows(rev: RevenueEntry[], costs: CostEntry[], buckets: Bucket[]) {
  const revenue = sumByBucket(rev, buckets, (r) => r.ts, (r) => r.revenueUsd)
  const cost = sumByBucket(costs, buckets, (c) => c.ts, (c) => c.amountUsd)
  return buckets.map((b, i) => {
    const margin = revenue[i]! - cost[i]!
    return { key: b.key, label: b.label, title: b.title, revenue: Math.round(revenue[i]!), cost: Math.round(cost[i]!), margin: Math.round(margin), marginPct: revenue[i]! > 0 ? Math.round((margin / revenue[i]!) * 1000) / 10 : null }
  })
}

/* ------------------------------------------------------------------------------------------------
 * Receivables / payables
 * ---------------------------------------------------------------------------------------------- */
export const invoiceBalance = (i: Pick<Invoice, 'amountUsd' | 'paidUsd'>) => Math.max(0, Math.round((i.amountUsd - i.paidUsd) * 100) / 100)

/** Days past due (>0 = overdue). Paid invoices are never overdue. */
export function daysPastDue(i: Invoice, now = Date.now()): number {
  if (i.status === 'paid' || i.status === 'draft' || invoiceBalance(i) <= 0) return 0
  const diff = now - new Date(i.dueDate).getTime()
  return diff > 0 ? Math.max(1, Math.floor(diff / 864e5)) : 0
}

/** Status shown to users — an unpaid issued invoice past its due date is overdue regardless of the stored status. */
export function effectiveInvoiceStatus(i: Invoice, now = Date.now()): Invoice['status'] {
  if (i.status === 'draft') return 'draft'
  if (invoiceBalance(i) <= 0) return 'paid'
  if (new Date(i.dueDate).getTime() < now) return 'overdue'
  return i.paidUsd > 0 ? 'partial' : 'sent'
}

export const AGEING_BUCKETS = [
  { key: 'current', label: 'Current', min: -Infinity, max: 0 },
  { key: '1-30', label: '1–30 days', min: 1, max: 30 },
  { key: '31-60', label: '31–60 days', min: 31, max: 60 },
  { key: '61-90', label: '61–90 days', min: 61, max: 90 },
  { key: '90+', label: '90+ days', min: 91, max: Infinity },
] as const

export interface AgeingBucket {
  key: string
  label: string
  amount: number
  count: number
  invoices: Invoice[]
}

export function ageingBuckets(invoices: Invoice[], now = Date.now()): AgeingBucket[] {
  const out: AgeingBucket[] = AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: 0, count: 0, invoices: [] }))
  for (const inv of invoices) {
    if (inv.status === 'draft') continue
    const bal = invoiceBalance(inv)
    if (bal <= 0) continue
    const dpd = daysPastDue(inv, now)
    const idx = AGEING_BUCKETS.findIndex((b) => dpd >= b.min && dpd <= b.max)
    const bucket = out[Math.max(0, idx)]!
    bucket.amount += bal
    bucket.count += 1
    bucket.invoices.push(inv)
  }
  return out
}

/** Customer invoices inherit the branch of the trips they bill (the stored branch is the issuing office). */
export function withDerivedBranch(invoices: Invoice[], tripBranch: (id: string) => string | undefined): Invoice[] {
  return invoices.map((inv) => {
    if (inv.kind !== 'customer' || !inv.tripIds.length) return inv
    const counts = new Map<string, number>()
    for (const id of inv.tripIds) {
      const b = tripBranch(id)
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1)
    }
    let best = inv.branchId
    let n = 0
    for (const [b, c] of counts) if (c > n) { best = b; n = c }
    return best === inv.branchId ? inv : { ...inv, branchId: best }
  })
}

/**
 * Billing index. A trip counts as billed once it appears on an invoice that was issued on/after the trip was delivered;
 * trips delivered after the invoice's issue date are late additions and remain billable.
 */
export function billedTripMap(invoices: Invoice[], trips: Trip[]): Map<string, Invoice> {
  const byId = new Map(trips.map((t) => [t.id, t]))
  const out = new Map<string, Invoice>()
  for (const inv of invoices) {
    if (inv.kind !== 'customer') continue
    const issued = new Date(inv.issueDate).getTime()
    for (const id of inv.tripIds) {
      const t = byId.get(id)
      if (!t?.actualEnd || new Date(t.actualEnd).getTime() <= issued + 1000) out.set(id, inv)
    }
  }
  return out
}

export function unbilledTrips(trips: Trip[], invoices: Invoice[], customerId?: string | null): Trip[] {
  const billed = billedTripMap(invoices, trips)
  return trips
    .filter((t) => t.status === 'completed' && !!t.customerId && t.revenueUsd > 0 && (!customerId || t.customerId === customerId) && !billed.has(t.id))
    .sort((a, b) => (b.actualEnd ?? '').localeCompare(a.actualEnd ?? ''))
}

export function nextInvoiceNumber(invoices: Invoice[], kind: Invoice['kind'], issued: Date = new Date()): string {
  let max = kind === 'customer' ? 1100 : 4400
  for (const i of invoices) {
    if (i.kind !== kind) continue
    const m = /-(\d+)$/.exec(i.number)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return kind === 'customer' ? `INV-${issued.getFullYear()}-${max + 1}` : `SUP-${max + 1}`
}

/** Timestamp stored when an invoice is issued on a calendar day: "now" if today, otherwise end of that day. */
export function issueTimestamp(day: Date): Date {
  const today = new Date()
  return day.toDateString() === today.toDateString() ? today : endOfDay(day)
}

export const PAYMENT_METHODS = ['Bank transfer', 'RTGS', 'EcoCash Business', 'Cash', 'Cheque', 'Card'] as const

/* ------------------------------------------------------------------------------------------------
 * Budgets
 * ---------------------------------------------------------------------------------------------- */
export const monthOf = (t: number | Date | string): string => {
  const d = t instanceof Date ? t : new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export const periodStart = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1)
}
export const shiftPeriod = (period: string, n: number) => format(addMonths(periodStart(period), n), 'yyyy-MM')
export const periodLabel = (period: string, pattern = 'MMMM yyyy') => format(periodStart(period), pattern)

export type CostLookup = (period: string, category: CostCategory, branchId: string) => number

/** Pre-aggregated (period, category, branch|all) cost lookup over unscoped entries. */
export function buildCostLookup(entries: CostEntry[]): CostLookup {
  const m = new Map<string, number>()
  const add = (k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  for (const e of entries) {
    const p = monthOf(e.ts)
    add(`${p}|${e.category}|${e.branchId}`, e.amountUsd)
    add(`${p}|${e.category}|all`, e.amountUsd)
  }
  return (period, category, branchId) => m.get(`${period}|${category}|${branchId}`) ?? 0
}

export interface ResolvedBudget {
  amount: number
  source: 'company' | 'branch' | 'allocated' | 'none'
  id?: string
}

/**
 * Budget for a category/month in the current scope. Company-wide budgets are stored with branchId 'all'.
 * A branch scope uses a branch-specific row when one exists, otherwise a share of the company budget
 * proportional to the branch's trailing three-month spend in that category.
 */
export function resolveBudget(budgets: Budget[], period: string, category: CostCategory, branchId: string, costAt: CostLookup): ResolvedBudget {
  const own = budgets.find((b) => b.period === period && b.category === category && b.branchId === branchId)
  if (own) return { amount: own.budgetUsd, source: branchId === 'all' ? 'company' : 'branch', id: own.id }
  if (branchId === 'all') return { amount: 0, source: 'none' }
  const company = budgets.find((b) => b.period === period && b.category === category && b.branchId === 'all')
  if (!company) return { amount: 0, source: 'none' }
  let br = 0
  let co = 0
  for (let i = 1; i <= 3; i++) {
    const p = shiftPeriod(period, -i)
    br += costAt(p, category, branchId)
    co += costAt(p, category, 'all')
  }
  if (co <= 0) {
    br = costAt(period, category, branchId)
    co = costAt(period, category, 'all')
  }
  const share = co > 0 ? br / co : 0
  return { amount: Math.round(company.budgetUsd * share), source: 'allocated', id: company.id }
}

/** Fraction of a month elapsed (1 for past months, 0 for future ones). */
export function elapsedFraction(period: string, now = Date.now()): number {
  const start = periodStart(period)
  const end = endOfMonth(start)
  if (now >= end.getTime()) return 1
  if (now < start.getTime()) return 0
  return (differenceInCalendarDays(now, start) + 1) / (differenceInCalendarDays(end, start) + 1)
}

export type BudgetState = 'none' | 'ok' | 'at_risk' | 'over'

export interface BudgetLine {
  category: CostCategory
  budget: number
  actual: number
  variance: number
  variancePct: number | null
  usedPct: number | null
  forecast: number | null
  state: BudgetState
  source: ResolvedBudget['source']
  budgetId?: string
}

function makeLine(category: CostCategory, budget: ResolvedBudget, actual: number, elapsed: number): BudgetLine {
  const forecast = elapsed >= 1 ? actual : elapsed >= 0.12 ? actual / elapsed : null
  const variance = actual - budget.amount
  let state: BudgetState = 'ok'
  if (!budget.amount) state = actual > 0 ? 'none' : 'ok'
  else if (actual > budget.amount) state = 'over'
  else if (elapsed < 1 && forecast !== null && forecast > budget.amount) state = 'at_risk'
  else if (elapsed >= 1 && actual > budget.amount * 0.92) state = 'at_risk'
  return {
    category, budget: budget.amount, actual, variance, variancePct: budget.amount ? (variance / budget.amount) * 100 : null,
    usedPct: budget.amount ? (actual / budget.amount) * 100 : null, forecast, state, source: budget.source, budgetId: budget.id,
  }
}

export function budgetLines(budgets: Budget[], costAt: CostLookup, period: string, branchId: string, now = Date.now()) {
  const elapsed = elapsedFraction(period, now)
  const all = COST_CATEGORIES.map((c) => makeLine(c, resolveBudget(budgets, period, c, branchId, costAt), costAt(period, c, branchId), elapsed))
  const lines = all.filter((l) => l.source !== 'none' || l.actual > 0)
  const missing = all.filter((l) => l.source === 'none' && l.actual <= 0).map((l) => l.category)
  const tb = lines.reduce((s, l) => s + l.budget, 0)
  const ta = lines.reduce((s, l) => s + l.actual, 0)
  const total = makeLine('other', { amount: tb, source: 'company' }, ta, elapsed)
  return { lines, missing, total, elapsed }
}

/**
 * Budget vs actual over an arbitrary date range: each month's budget is pro-rated by the days of that month inside the range.
 * Only months that actually have budgets are compared, so periods outside the budget horizon do not distort the variance.
 */
export function rangeBudget(budgets: Budget[], costAt: CostLookup, scopedCosts: CostEntry[], branchId: string, from: Date, to: Date) {
  const periods = new Set(budgets.map((b) => b.period))
  const byCat = new Map<CostCategory, { budget: number; actual: number }>(COST_CATEGORIES.map((c) => [c, { budget: 0, actual: 0 }]))
  let cursor = startOfMonth(from)
  while (cursor <= to) {
    const period = monthOf(cursor)
    if (periods.has(period)) {
      const mStart = cursor
      const mEnd = endOfMonth(cursor)
      const overlapStart = from > mStart ? from : mStart
      const overlapEnd = to < mEnd ? to : mEnd
      const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1)
      const frac = overlapDays / (differenceInCalendarDays(mEnd, mStart) + 1)
      for (const c of COST_CATEGORIES) byCat.get(c)!.budget += resolveBudget(budgets, period, c, branchId, costAt).amount * frac
    }
    cursor = addMonths(cursor, 1)
  }
  const f = from.getTime()
  const t = to.getTime()
  for (const e of scopedCosts) if (e.ts >= f && e.ts <= t && periods.has(monthOf(e.ts))) byCat.get(e.category)!.actual += e.amountUsd
  const rows = COST_CATEGORIES.map((c) => ({ category: c, ...byCat.get(c)! }))
  const budget = rows.reduce((s, r) => s + r.budget, 0)
  const actual = rows.reduce((s, r) => s + r.actual, 0)
  return { rows, budget, actual, variance: actual - budget, variancePct: budget > 0 ? ((actual - budget) / budget) * 100 : null }
}

/* ------------------------------------------------------------------------------------------------
 * Profitability
 * ---------------------------------------------------------------------------------------------- */
export interface VehiclePnl {
  vehicleId: string
  reg: string
  make: string
  model: string
  vehicleCategory: VehicleCategory
  branchId: string
  trips: number
  km: number
  revenue: number
  byCategory: Cats
  fuel: number
  maintenance: number
  other: number
  overhead: number
  cost: number
  margin: number
  marginPct: number | null
  costPerKm: number | null
  revenuePerKm: number | null
}

export function vehiclePnl(vehicleById: (id: string) => Vehicle | undefined, rev: RevenueEntry[], costs: CostEntry[], allocateOverhead: boolean) {
  const rows = new Map<string, VehiclePnl>()
  const get = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      const v = vehicleById(id)
      if (!v) return undefined
      r = { vehicleId: id, reg: v.reg, make: v.make, model: v.model, vehicleCategory: v.category, branchId: v.branchId, trips: 0, km: 0, revenue: 0, byCategory: emptyCats(), fuel: 0, maintenance: 0, other: 0, overhead: 0, cost: 0, margin: 0, marginPct: null, costPerKm: null, revenuePerKm: null }
      rows.set(id, r)
    }
    return r
  }
  for (const r of rev) {
    if (!r.vehicleId) continue
    const row = get(r.vehicleId)
    if (!row) continue
    row.trips += 1
    row.km += r.km
    row.revenue += r.revenueUsd
  }
  let overheadPool = 0
  const overheadCats = emptyCats()
  for (const c of costs) {
    if (!c.vehicleId) {
      overheadPool += c.amountUsd
      overheadCats[c.category] += c.amountUsd
      continue
    }
    const row = get(c.vehicleId)
    if (row) row.byCategory[c.category] += c.amountUsd
  }
  const list = [...rows.values()]
  if (allocateOverhead && list.length) {
    for (const row of list) {
      row.overhead = overheadPool / list.length
      for (const c of COST_CATEGORIES) row.byCategory[c] += overheadCats[c] / list.length
    }
  }
  for (const row of list) {
    row.cost = sumCats(row.byCategory)
    row.fuel = row.byCategory.fuel
    row.maintenance = row.byCategory.maintenance
    row.other = row.cost - row.fuel - row.maintenance
    row.margin = row.revenue - row.cost
    row.marginPct = row.revenue > 0 ? (row.margin / row.revenue) * 100 : null
    row.costPerKm = row.km > 0 ? row.cost / row.km : null
    row.revenuePerKm = row.km > 0 ? row.revenue / row.km : null
  }
  return { rows: list, overheadPool }
}

export interface TripEcon {
  tripId: string
  ref: string
  vehicleId: string | null
  customerId: string | null
  origin: string
  destination: string
  revenue: number
  cost: number
  km: number
}

/**
 * Per-trip economics: linked costs (fuel / expenses carrying the trip id) plus an km-weighted share of each vehicle's other costs
 * (maintenance, tyres, licensing, unlinked fuel…). Costs that cannot be attributed to a delivered trip are returned as `unallocated`.
 */
export function tripEconomics(rev: RevenueEntry[], costs: CostEntry[]) {
  const tripSet = new Map(rev.map((r) => [r.tripId, r]))
  const direct = new Map<string, number>()
  const pool = new Map<string, number>()
  let total = 0
  for (const c of costs) {
    total += c.amountUsd
    if (c.tripId && tripSet.has(c.tripId)) direct.set(c.tripId, (direct.get(c.tripId) ?? 0) + c.amountUsd)
    else if (c.vehicleId) pool.set(c.vehicleId, (pool.get(c.vehicleId) ?? 0) + c.amountUsd)
  }
  const kmByVehicle = new Map<string, number>()
  for (const r of rev) if (r.vehicleId) kmByVehicle.set(r.vehicleId, (kmByVehicle.get(r.vehicleId) ?? 0) + r.km)
  let allocated = 0
  const trips: TripEcon[] = rev.map((r) => {
    const d = direct.get(r.tripId) ?? 0
    const vKm = r.vehicleId ? kmByVehicle.get(r.vehicleId) ?? 0 : 0
    const share = r.vehicleId && vKm > 0 ? (pool.get(r.vehicleId) ?? 0) * (r.km / vKm) : 0
    allocated += d + share
    return { tripId: r.tripId, ref: r.ref, vehicleId: r.vehicleId, customerId: r.customerId, origin: r.origin, destination: r.destination, revenue: r.revenueUsd, cost: d + share, km: r.km }
  })
  return { trips, unallocated: Math.max(0, total - allocated) }
}

export interface GroupPnl {
  key: string
  label: string
  trips: number
  km: number
  revenue: number
  cost: number
  margin: number
  marginPct: number | null
  costPerKm: number | null
  revenuePerKm: number | null
}

export function finishGroup(g: { key: string; label: string; trips: number; km: number; revenue: number; cost: number }): GroupPnl {
  const margin = g.revenue - g.cost
  return { ...g, margin, marginPct: g.revenue > 0 ? (margin / g.revenue) * 100 : null, costPerKm: g.km > 0 ? g.cost / g.km : null, revenuePerKm: g.km > 0 ? g.revenue / g.km : null }
}

export function groupTrips(trips: TripEcon[], keyOf: (t: TripEcon) => string, labelOf: (key: string) => string): GroupPnl[] {
  const m = new Map<string, { key: string; label: string; trips: number; km: number; revenue: number; cost: number }>()
  for (const t of trips) {
    const key = keyOf(t)
    let g = m.get(key)
    if (!g) {
      g = { key, label: labelOf(key), trips: 0, km: 0, revenue: 0, cost: 0 }
      m.set(key, g)
    }
    g.trips += 1
    g.km += t.km
    g.revenue += t.revenue
    g.cost += t.cost
  }
  return [...m.values()].map(finishGroup)
}

export const vehicleToGroup = (v: VehiclePnl): GroupPnl => finishGroup({ key: v.vehicleId, label: v.reg, trips: v.trips, km: v.km, revenue: v.revenue, cost: v.cost })

/* ------------------------------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------------------------- */
export const round2 = (n: number) => Math.round(n * 100) / 100
export const addDaysIso = (iso: string | Date, days: number) => addDays(new Date(iso), days)
export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`)

/**
 * Fuel module calculations: consumption (L/100 km from odometer deltas between consecutive fills), expected litres,
 * suspicious-consumption rules, month reconciliation and card-statement matching.
 *
 * Everything here is pure (no React / store access) so it can be reused by reports and tested in isolation.
 *
 * Method
 * ------
 * Fills are grouped per vehicle and ordered by time. The litres bought at fill *n* are assumed to replace the fuel burnt
 * since fill *n-1* (full-tank method), so
 *     distance(n)  = odometer(n) - odometer(n-1)
 *     L/100km(n)   = litres(n) / distance(n) * 100
 *     expected(n)  = distance(n) * benchmark(category) / 100
 * Intervals shorter than MIN_INTERVAL_KM, or whose consumption is wildly outside the category benchmark (missed fills,
 * odometer glitches) are kept for display but excluded from efficiency statistics (`reliable === false`).
 */
import { format } from 'date-fns'
import type { Branch, Driver, FuelCard, FuelStation, FuelTransaction, Invoice, Vehicle, VehicleCategory } from '@/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Expected consumption (L/100 km) per vehicle category — the fleet's efficiency benchmark. */
export const BENCHMARK_L_PER_100: Record<VehicleCategory, number> = {
  heavy_truck: 38, tanker: 40, refrigerated: 24, bus: 30, light_truck: 18, delivery_van: 12, pickup: 11, service: 11, motorcycle: 3.5,
}
export const MIN_INTERVAL_KM = 40
/** An interval is "reliable" when its consumption lies within this multiple of the benchmark. */
export const PLAUSIBLE_RANGE: [number, number] = [0.35, 2.4]
export const OVER_EXPECTED_PCT = 25
export const TANK_TOLERANCE = 1.1
export const DUPLICATE_WINDOW_H = 3
export const RECON_TOLERANCE_PCT = 15
export const STATEMENT_TOLERANCE_USD = 1

// ---------------------------------------------------------------------------
// Flags & rules
// ---------------------------------------------------------------------------
export type FuelRuleKey = 'overfill' | 'odd_hours' | 'over_expected' | 'duplicate' | 'odometer' | 'other'

export interface RuleMeta {
  label: string
  short: string
  summary: string
  action: string
}

export const FUEL_RULES: Record<FuelRuleKey, RuleMeta> = {
  overfill: {
    label: 'Tank overfill',
    short: 'Overfill',
    summary: 'Litres purchased exceed the tank capacity of the vehicle.',
    action: 'Compare with the pump receipt and the tank sensor; look for siphoning, jerrycan filling or the card being used on another vehicle.',
  },
  odd_hours: {
    label: 'Odd-hours purchase',
    short: 'Odd hours',
    summary: 'Fuel bought between 00:00 and 04:00, outside normal operating hours.',
    action: 'Check the vehicle’s GPS trail for that time — was it on a trip? Confirm with the driver and the station attendant.',
  },
  over_expected: {
    label: 'Above expected consumption',
    short: 'Over expected',
    summary: 'More litres bought than the distance driven justifies at the category benchmark.',
    action: 'Inspect the vehicle for leaks / injector faults and review driving behaviour; verify the odometer reading.',
  },
  duplicate: {
    label: 'Possible duplicate',
    short: 'Duplicate',
    summary: 'A second fill for the same vehicle within 3 hours of the previous one.',
    action: 'Confirm that the two fills are genuinely separate — a double swipe or a duplicated receipt is common.',
  },
  odometer: {
    label: 'Odometer mismatch',
    short: 'Odometer',
    summary: 'The odometer reading is lower than (or inconsistent with) the previous fill.',
    action: 'Ask the driver to re-confirm the reading; an incorrect odometer invalidates efficiency tracking.',
  },
  other: {
    label: 'Other anomaly',
    short: 'Anomaly',
    summary: 'Flagged by a custom detection rule.',
    action: 'Review the transaction details.',
  },
}

export type FlagReviewStatus = 'reviewing' | 'escalated'
export interface FlagReview {
  status: FlagReviewStatus
  by: string
  at: string
  note?: string
  incidentId?: string
}
/** A transaction flag, optionally carrying the review state set from this module. */
export type FuelFlag = NonNullable<FuelTransaction['flag']> & { review?: FlagReview }
export const flagOf = (t: Pick<FuelTransaction, 'flag'>): FuelFlag | null => (t.flag as FuelFlag | null) ?? null

export type FlagState = 'none' | 'open' | 'reviewing' | 'escalated'

export function classifyFlag(reason: string): FuelRuleKey {
  if (/exceed.*tank|overfill/i.test(reason)) return 'overfill'
  if (/operating hours|odd hours/i.test(reason)) return 'odd_hours'
  if (/above expected|% above/i.test(reason)) return 'over_expected'
  if (/duplicate/i.test(reason)) return 'duplicate'
  if (/odometer/i.test(reason)) return 'odometer'
  return 'other'
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 } as const
export const severityRank = (s: 'low' | 'medium' | 'high') => SEVERITY_RANK[s]

// ---------------------------------------------------------------------------
// Enriched rows
// ---------------------------------------------------------------------------
export interface FuelLookups {
  vehicles: Vehicle[]
  stations: FuelStation[]
  drivers: Driver[]
  cards: FuelCard[]
  branches: Branch[]
}

export interface FuelRow extends FuelTransaction {
  reg: string
  category: VehicleCategory | null
  tankL: number
  driverName: string
  stationName: string
  brand: string
  city: string
  cardNumber: string
  branchName: string
  rule: FuelRuleKey | null
  flagState: FlagState
  /** previous (trusted) fill of the same vehicle */
  prevId: string | null
  prevRef: string | null
  prevDate: string | null
  prevOdometerKm: number | null
  gapHours: number | null
  distanceKm: number | null
  l100: number | null
  benchmark: number
  expectedL: number | null
  varianceL: number | null
  variancePct: number | null
  /** interval usable in efficiency statistics */
  reliable: boolean
  tankFillPct: number
}

const cmpDate = (a: FuelTransaction, b: FuelTransaction) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id))

export function flagState(t: Pick<FuelTransaction, 'flag'>): FlagState {
  const f = flagOf(t)
  if (!f) return 'none'
  return f.review?.status === 'escalated' ? 'escalated' : f.review?.status === 'reviewing' ? 'reviewing' : 'open'
}

type Derived = Pick<FuelRow, 'prevId' | 'prevRef' | 'prevDate' | 'prevOdometerKm' | 'gapHours' | 'distanceKm' | 'l100' | 'expectedL' | 'varianceL' | 'variancePct' | 'reliable'>

/** Builds one enriched row per transaction, deriving distance / efficiency from each vehicle's fill history. */
export function enrichFuel(txs: FuelTransaction[], lk: FuelLookups): FuelRow[] {
  const vehicleById = new Map(lk.vehicles.map((v) => [v.id, v]))
  const stationById = new Map(lk.stations.map((s) => [s.id, s]))
  const driverById = new Map(lk.drivers.map((d) => [d.id, d]))
  const cardById = new Map(lk.cards.map((c) => [c.id, c]))
  const branchById = new Map(lk.branches.map((b) => [b.id, b]))

  const byVehicle = new Map<string, FuelTransaction[]>()
  for (const t of txs) {
    const list = byVehicle.get(t.vehicleId)
    if (list) list.push(t)
    else byVehicle.set(t.vehicleId, [t])
  }

  const derived = new Map<string, Derived>()
  for (const [vid, list] of byVehicle) {
    list.sort(cmpDate)
    const v = vehicleById.get(vid)
    const bench = v ? BENCHMARK_L_PER_100[v.category] : 20
    let trusted: FuelTransaction | null = null
    let previous: FuelTransaction | null = null
    for (const t of list) {
      const rule = t.flag ? classifyFlag(t.flag.reason) : null
      let distance: number | null = null
      if (trusted && rule !== 'odometer') {
        const d = t.odometerKm - trusted.odometerKm
        if (d > 0) distance = d
      }
      const usable = distance !== null && distance >= MIN_INTERVAL_KM
      const l100 = usable ? (t.litres / distance!) * 100 : null
      const expectedL = usable ? (distance! * bench) / 100 : null
      const reliable = l100 !== null && l100 >= bench * PLAUSIBLE_RANGE[0] && l100 <= bench * PLAUSIBLE_RANGE[1]
      derived.set(t.id, {
        prevId: trusted?.id ?? null,
        prevRef: trusted?.ref ?? null,
        prevDate: trusted?.date ?? null,
        prevOdometerKm: trusted?.odometerKm ?? null,
        gapHours: previous ? (new Date(t.date).getTime() - new Date(previous.date).getTime()) / 36e5 : null,
        distanceKm: distance,
        l100,
        expectedL,
        varianceL: expectedL !== null ? t.litres - expectedL : null,
        variancePct: expectedL ? ((t.litres - expectedL) / expectedL) * 100 : null,
        reliable,
      })
      if (rule !== 'odometer') trusted = t
      previous = t
    }
  }

  return txs.map((t) => {
    const v = vehicleById.get(t.vehicleId)
    const st = stationById.get(t.stationId)
    const d = derived.get(t.id)!
    const f = t.flag
    return {
      ...t,
      reg: v?.reg ?? '—',
      category: v?.category ?? null,
      tankL: v?.tankCapacityL ?? 0,
      driverName: (t.driverId && driverById.get(t.driverId)?.name) || '',
      stationName: st?.name ?? 'Unknown station',
      brand: st?.brand ?? '—',
      city: st?.city ?? '—',
      cardNumber: (t.cardId && cardById.get(t.cardId)?.number) || '',
      branchName: branchById.get(t.branchId)?.name ?? '—',
      rule: f ? classifyFlag(f.reason) : null,
      flagState: flagState(t),
      benchmark: v ? BENCHMARK_L_PER_100[v.category] : 20,
      tankFillPct: v?.tankCapacityL ? (t.litres / v.tankCapacityL) * 100 : 0,
      ...d,
    }
  })
}

// ---------------------------------------------------------------------------
// Detection (applied to newly created transactions)
// ---------------------------------------------------------------------------
export interface DetectInput {
  vehicle: Vehicle
  litres: number
  date: string
  odometerKm: number
  /** every existing transaction of the same vehicle */
  history: FuelTransaction[]
}

/** Runs the detection rules against a new fill and returns the most severe flag (or null). */
export function detectFlag({ vehicle, litres, date, odometerKm, history }: DetectInput): FuelTransaction['flag'] {
  const t = new Date(date).getTime()
  const found: NonNullable<FuelTransaction['flag']>[] = []
  const earlier = history.filter((h) => h.date < date).sort(cmpDate)
  const trusted = [...earlier].reverse().find((h) => !h.flag || classifyFlag(h.flag.reason) !== 'odometer') ?? null

  if (litres > vehicle.tankCapacityL) {
    found.push({
      reason: `Litres (${Math.round(litres)} L) exceed tank capacity (${vehicle.tankCapacityL} L)`,
      severity: litres > vehicle.tankCapacityL * 1.05 ? 'high' : 'medium',
      expectedLitres: vehicle.tankCapacityL,
    })
  }
  if (trusted) {
    const distance = odometerKm - trusted.odometerKm
    if (distance >= MIN_INTERVAL_KM) {
      const expected = (distance * BENCHMARK_L_PER_100[vehicle.category]) / 100
      const over = ((litres - expected) / expected) * 100
      if (over > OVER_EXPECTED_PCT) {
        found.push({ reason: `Consumption ${Math.round(over)}% above expected for distance driven`, severity: over > 40 ? 'high' : 'medium', expectedLitres: Math.round(expected) })
      }
    } else if (distance < 0) {
      found.push({ reason: 'Odometer reading inconsistent with previous fill', severity: 'low' })
    }
  }
  if (history.some((h) => Math.abs(new Date(h.date).getTime() - t) <= DUPLICATE_WINDOW_H * 36e5)) {
    found.push({ reason: 'Possible duplicate: second fill within 3 hours', severity: 'medium' })
  }
  if (new Date(date).getHours() < 4) {
    found.push({ reason: 'Transaction outside operating hours (00:00–04:00)', severity: 'medium' })
  }
  if (!found.length) return null
  return found.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]!
}

export interface RuleExplanation {
  rule: FuelRuleKey
  title: string
  /** a one-line, number-rich explanation of why the transaction was flagged */
  detail: string
  action: string
}

const fmt1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
const fmt0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

/** Human explanation for a flagged transaction, using the computed values. */
export function explainFlag(r: FuelRow): RuleExplanation | null {
  const f = flagOf(r)
  if (!f) return null
  const rule = r.rule ?? classifyFlag(f.reason)
  const meta = FUEL_RULES[rule]
  let detail = f.reason
  switch (rule) {
    case 'overfill':
      detail = `${fmt1(r.litres)} L purchased into a ${fmt0(r.tankL)} L tank — ${fmt0(r.tankFillPct)}% of capacity (${fmt1(r.litres - r.tankL)} L more than the tank can hold).`
      break
    case 'odd_hours': {
      const hh = new Date(r.date)
      detail = `Fill recorded at ${format(hh, 'HH:mm')} on ${format(hh, 'd MMM')}, outside the normal 04:00–24:00 operating window.`
      break
    }
    case 'over_expected': {
      const expected = r.expectedL ?? f.expectedLitres
      detail = expected
        ? `${fmt1(r.litres)} L bought versus ${fmt1(expected)} L expected${r.distanceKm ? ` for ${fmt0(r.distanceKm)} km at the ${r.benchmark} L/100 km benchmark` : ''} (${expected > 0 ? `+${fmt0(((r.litres - expected) / expected) * 100)}%` : 'over'}).`
        : f.reason
      break
    }
    case 'duplicate':
      detail = r.gapHours !== null ? `Previous fill for this vehicle was only ${r.gapHours < 1 ? `${Math.round(r.gapHours * 60)} minutes` : `${fmt1(r.gapHours)} hours`} earlier${r.prevRef ? ` (${r.prevRef})` : ''}.` : f.reason
      break
    case 'odometer':
      detail = r.prevOdometerKm !== null ? `Odometer ${fmt0(r.odometerKm)} km is ${fmt0(Math.abs(r.odometerKm - r.prevOdometerKm))} km ${r.odometerKm < r.prevOdometerKm ? 'below' : 'out of line with'} the previous reading of ${fmt0(r.prevOdometerKm)} km.` : f.reason
      break
    default:
      break
  }
  return { rule, title: meta.label, detail, action: meta.action }
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------
export interface EfficiencyAgg {
  litres: number
  km: number
  spend: number
  fills: number
  l100: number | null
  costPerKm: number | null
}

/** Distance-weighted efficiency over the reliable intervals of `rows`. */
export function aggregateEfficiency(rows: FuelRow[]): EfficiencyAgg {
  let litres = 0
  let km = 0
  let spend = 0
  let fills = 0
  for (const r of rows) {
    if (r.reliable && r.distanceKm) {
      litres += r.litres
      km += r.distanceKm
      spend += r.totalUsd
      fills++
    }
  }
  return { litres, km, spend, fills, l100: km > 0 ? (litres / km) * 100 : null, costPerKm: km > 0 ? spend / km : null }
}

export function groupRows<T extends string>(rows: FuelRow[], key: (r: FuelRow) => T): Map<T, FuelRow[]> {
  const m = new Map<T, FuelRow[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

export interface VehicleEfficiency {
  vehicleId: string
  reg: string
  category: VehicleCategory
  branchId: string
  l100: number
  benchmark: number
  /** % above (+) / below (−) the category benchmark */
  deltaPct: number
  km: number
  litres: number
  spend: number
  fills: number
}

export function vehicleEfficiency(rows: FuelRow[], minFills = 2): VehicleEfficiency[] {
  const out: VehicleEfficiency[] = []
  for (const [vid, list] of groupRows(rows, (r) => r.vehicleId)) {
    const a = aggregateEfficiency(list)
    const first = list[0]!
    if (a.l100 === null || a.fills < minFills || !first.category) continue
    out.push({ vehicleId: vid, reg: first.reg, category: first.category, branchId: first.branchId, l100: a.l100, benchmark: first.benchmark, deltaPct: ((a.l100 - first.benchmark) / first.benchmark) * 100, km: a.km, litres: a.litres, spend: a.spend, fills: a.fills })
  }
  return out
}

/** Spend-weighted average price per litre. */
export function avgPrice(rows: { litres: number; totalUsd: number }[]): number {
  let l = 0
  let s = 0
  for (const r of rows) {
    l += r.litres
    s += r.totalUsd
  }
  return l > 0 ? s / l : 0
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
export interface MonthOption {
  value: string
  label: string
  start: Date
  end: Date
}

/** Calendar months from the earliest transaction up to the current month (newest first). */
export function monthOptions(rows: { date: string }[], now = new Date()): MonthOption[] {
  let earliest = now.getTime()
  for (const r of rows) {
    const t = new Date(r.date).getTime()
    if (t < earliest) earliest = t
  }
  const out: MonthOption[] = []
  const cursor = new Date(new Date(earliest).getFullYear(), new Date(earliest).getMonth(), 1)
  while (cursor <= now) {
    const start = new Date(cursor)
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    out.push({ value: format(start, 'yyyy-MM'), label: format(start, 'MMMM yyyy'), start, end })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out.reverse()
}

export type ReconStatus = 'matched' | 'variance' | 'flagged' | 'no_data'

export interface VehicleRecon {
  vehicleId: string
  reg: string
  category: VehicleCategory | null
  branchId: string
  fills: number
  litres: number
  spend: number
  /** fills with a usable odometer interval — the basis of the comparison */
  comparedFills: number
  comparedLitres: number
  km: number
  expectedL: number
  varianceL: number
  variancePct: number | null
  unreconciled: number
  openFlags: number
  status: ReconStatus
  rows: FuelRow[]
}

export function reconcileVehicles(rows: FuelRow[], start: Date, end: Date, tolerancePct = RECON_TOLERANCE_PCT): VehicleRecon[] {
  const s = start.getTime()
  const e = end.getTime()
  const inMonth = rows.filter((r) => {
    const t = new Date(r.date).getTime()
    return t >= s && t < e
  })
  const out: VehicleRecon[] = []
  for (const [vid, list] of groupRows(inMonth, (r) => r.vehicleId)) {
    const first = list[0]!
    let litres = 0
    let spend = 0
    let comparedFills = 0
    let comparedLitres = 0
    let km = 0
    let expectedL = 0
    let unreconciled = 0
    let openFlags = 0
    for (const r of list) {
      litres += r.litres
      spend += r.totalUsd
      if (!r.reconciled) unreconciled++
      if (r.flagState === 'open' || r.flagState === 'reviewing') openFlags++
      if (r.reliable && r.expectedL !== null && r.distanceKm) {
        comparedFills++
        comparedLitres += r.litres
        km += r.distanceKm
        expectedL += r.expectedL
      }
    }
    const varianceL = comparedLitres - expectedL
    const variancePct = expectedL > 0 ? (varianceL / expectedL) * 100 : null
    const status: ReconStatus = openFlags > 0 ? 'flagged' : variancePct === null ? 'no_data' : Math.abs(variancePct) > tolerancePct ? 'variance' : 'matched'
    out.push({ vehicleId: vid, reg: first.reg, category: first.category, branchId: first.branchId, fills: list.length, litres, spend, comparedFills, comparedLitres, km, expectedL, varianceL, variancePct, unreconciled, openFlags, status, rows: list })
  }
  return out.sort((a, b) => a.reg.localeCompare(b.reg))
}

export interface StatementRecon {
  provider: string
  invoiceId: string | null
  invoiceNumber: string | null
  invoiceStatus: Invoice['status'] | null
  statementUsd: number | null
  recordedUsd: number
  recordedLitres: number
  fills: number
  unreconciled: number
  diffUsd: number | null
  status: 'matched' | 'variance' | 'no_statement'
  txIds: string[]
}

/** Card statement (supplier invoice per brand/month) versus the transactions recorded in FleetCore. */
export function reconcileStatements(rows: FuelRow[], invoices: Invoice[], start: Date, end: Date): StatementRecon[] {
  const s = start.getTime()
  const e = end.getTime()
  const monthLabel = format(start, 'MMMM yyyy')
  const statements = invoices.filter((i) => i.kind === 'supplier' && /fuel card statement/i.test(i.description) && i.description.includes(monthLabel))
  const inMonth = rows.filter((r) => {
    const t = new Date(r.date).getTime()
    return t >= s && t < e
  })
  const providers = new Set<string>([...inMonth.map((r) => r.brand), ...statements.map((i) => i.partyName)])
  const out: StatementRecon[] = []
  for (const provider of providers) {
    const list = inMonth.filter((r) => r.brand === provider)
    const inv = statements.find((i) => i.partyName === provider) ?? null
    const recordedUsd = list.reduce((a, r) => a + r.totalUsd, 0)
    const diff = inv ? inv.amountUsd - recordedUsd : null
    out.push({
      provider,
      invoiceId: inv?.id ?? null,
      invoiceNumber: inv?.number ?? null,
      invoiceStatus: inv?.status ?? null,
      statementUsd: inv?.amountUsd ?? null,
      recordedUsd,
      recordedLitres: list.reduce((a, r) => a + r.litres, 0),
      fills: list.length,
      unreconciled: list.filter((r) => !r.reconciled).length,
      diffUsd: diff,
      status: !inv ? 'no_statement' : Math.abs(diff!) <= STATEMENT_TOLERANCE_USD ? 'matched' : 'variance',
      txIds: list.map((r) => r.id),
    })
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider))
}

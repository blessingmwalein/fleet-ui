import { useCallback, useMemo } from 'react'
import { endOfDay, format, parseISO, startOfDay, startOfMonth, startOfYear, subDays, subHours } from 'date-fns'
import { useUi, type RangePreset } from '@/store/ui'
import { useDb } from '@/store/db'
import { toDate } from '@/lib/format'

export const RANGE_PRESETS: { value: RangePreset; label: string; short: string }[] = [
  { value: '24h', label: 'Last 24 hours', short: '24h' },
  { value: '7d', label: 'Last 7 days', short: '7D' },
  { value: '30d', label: 'Last 30 days', short: '30D' },
  { value: '90d', label: 'Last 90 days', short: '90D' },
  { value: 'mtd', label: 'Month to date', short: 'MTD' },
  { value: 'ytd', label: 'Year to date', short: 'YTD' },
  { value: 'custom', label: 'Custom range', short: 'Custom' },
]

export function resolveRange(preset: RangePreset, customFrom: string, customTo: string, now = new Date()) {
  const to = now
  switch (preset) {
    case '24h': return { from: subHours(now, 24), to }
    case '7d': return { from: startOfDay(subDays(now, 6)), to }
    case '30d': return { from: startOfDay(subDays(now, 29)), to }
    case '90d': return { from: startOfDay(subDays(now, 89)), to }
    case 'mtd': return { from: startOfMonth(now), to }
    case 'ytd': return { from: startOfYear(now), to }
    case 'custom': {
      const f = customFrom ? startOfDay(parseISO(customFrom)) : startOfDay(subDays(now, 29))
      const t = customTo ? endOfDay(parseISO(customTo)) : now
      return { from: f, to: t }
    }
  }
}

export interface DateRange {
  preset: RangePreset
  from: Date
  to: Date
  /** Equal-length period immediately before `from` — for "vs previous period" comparisons. */
  prevFrom: Date
  prevTo: Date
  days: number
  label: string
  inRange: (v: string | number | Date | null | undefined) => boolean
  inPrevRange: (v: string | number | Date | null | undefined) => boolean
}

/** The global date range (top bar). All analytics should filter with `inRange`. */
export function useDateRange(): DateRange {
  const preset = useUi((s) => s.rangePreset)
  const customFrom = useUi((s) => s.customFrom)
  const customTo = useUi((s) => s.customTo)
  const seededAt = useDb((s) => s.seededAt)
  return useMemo(() => {
    // Round "now" to the minute so memoised selectors stay stable between renders.
    const now = new Date(Math.floor(Date.now() / 6e4) * 6e4)
    void seededAt
    const { from, to } = resolveRange(preset, customFrom, customTo, now)
    const span = to.getTime() - from.getTime()
    const prevTo = new Date(from.getTime() - 1)
    const prevFrom = new Date(from.getTime() - span - 1)
    const f = from.getTime()
    const t = to.getTime()
    const pf = prevFrom.getTime()
    const pt = prevTo.getTime()
    const inside = (a: number, b: number) => (v: string | number | Date | null | undefined) => {
      if (v === null || v === undefined) return false
      const x = toDate(v).getTime()
      return x >= a && x <= b
    }
    const label = preset === 'custom' ? `${format(from, 'dd MMM')} – ${format(to, 'dd MMM yyyy')}` : RANGE_PRESETS.find((p) => p.value === preset)!.label
    return { preset, from, to, prevFrom, prevTo, days: Math.max(1, Math.round(span / 864e5)), label, inRange: inside(f, t), inPrevRange: inside(pf, pt) }
  }, [preset, customFrom, customTo, seededAt])
}

/** The global branch/depot scope. */
export function useBranchScope() {
  const branchId = useUi((s) => s.branchId)
  const branches = useDb((s) => s.branches)
  const branch = branches.find((b) => b.id === branchId) ?? null
  /** Filter any list whose items carry a `branchId`. */
  const scope = useCallback(<T extends { branchId?: string }>(items: T[]): T[] => (branchId === 'all' ? items : items.filter((i) => i.branchId === branchId)), [branchId])
  return { branchId, branch, scope, isAll: branchId === 'all' }
}

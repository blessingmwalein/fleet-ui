import { endOfDay } from 'date-fns'
import type { DailyStat } from '@/types'
import { toDate } from '@/lib/format'

/** Daily telematics rows whose calendar day overlaps [from, to]. */
export function statsBetween(stats: DailyStat[], from: Date, to: Date): DailyStat[] {
  const f = from.getTime()
  const t = to.getTime()
  return stats.filter((d) => {
    const day = toDate(d.date)
    return endOfDay(day).getTime() >= f && day.getTime() <= t
  })
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/** A sparkline needs at least two points and some variation/signal to be worth drawing. */
export const sparkOrUndefined = (xs: number[]) => (xs.length > 1 && xs.some((x) => x !== 0) ? xs : undefined)

/** Cost of a work order in USD. */
export const workOrderCost = (w: { labourCostUsd: number; partsCostUsd: number }) => w.labourCostUsd + w.partsCostUsd

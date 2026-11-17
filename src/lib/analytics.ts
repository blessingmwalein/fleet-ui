import { addDays, addMonths, addWeeks, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { toDate } from './format'

export type Granularity = 'day' | 'week' | 'month'

export interface Bucket {
  key: string
  /** short axis label */
  label: string
  /** full label for tooltips */
  title: string
  start: number
  end: number
}

/** Pick a sensible bucket size for a range: ≤31d daily, ≤150d weekly, otherwise monthly. */
export function autoGranularity(days: number): Granularity {
  return days <= 31 ? 'day' : days <= 150 ? 'week' : 'month'
}

export function makeBuckets(from: Date, to: Date, g: Granularity): Bucket[] {
  const out: Bucket[] = []
  let cursor = g === 'day' ? startOfDay(from) : g === 'week' ? startOfWeek(from, { weekStartsOn: 1 }) : startOfMonth(from)
  const step = g === 'day' ? (d: Date) => addDays(d, 1) : g === 'week' ? (d: Date) => addWeeks(d, 1) : (d: Date) => addMonths(d, 1)
  while (cursor <= to) {
    const next = step(cursor)
    out.push({
      key: format(cursor, 'yyyy-MM-dd'),
      label: g === 'month' ? format(cursor, 'MMM') : format(cursor, g === 'week' ? 'd MMM' : 'd MMM'),
      title: g === 'day' ? format(cursor, 'EEE d MMM yyyy') : g === 'week' ? `Week of ${format(cursor, 'd MMM yyyy')}` : format(cursor, 'MMMM yyyy'),
      start: cursor.getTime(),
      end: next.getTime(),
    })
    cursor = next
  }
  return out
}

/** Index of the bucket containing timestamp `t` (or -1). Buckets are contiguous & sorted. */
export function bucketIndex(buckets: Bucket[], t: number): number {
  let lo = 0
  let hi = buckets.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b = buckets[mid]!
    if (t < b.start) hi = mid - 1
    else if (t >= b.end) lo = mid + 1
    else return mid
  }
  return -1
}

/** Sum a numeric value per bucket. */
export function sumByBucket<T>(items: T[], buckets: Bucket[], getDate: (t: T) => string | number | Date | null | undefined, getValue: (t: T) => number = () => 1): number[] {
  const out = new Array<number>(buckets.length).fill(0)
  for (const it of items) {
    const d = getDate(it)
    if (d === null || d === undefined) continue
    const i = bucketIndex(buckets, toDate(d).getTime())
    if (i >= 0) out[i]! += getValue(it)
  }
  return out
}

/** Average of values per bucket (empty buckets → 0). */
export function avgByBucket<T>(items: T[], buckets: Bucket[], getDate: (t: T) => string | number | Date | null | undefined, getValue: (t: T) => number): number[] {
  const sums = new Array<number>(buckets.length).fill(0)
  const counts = new Array<number>(buckets.length).fill(0)
  for (const it of items) {
    const d = getDate(it)
    if (d === null || d === undefined) continue
    const i = bucketIndex(buckets, toDate(d).getTime())
    if (i >= 0) {
      sums[i]! += getValue(it)
      counts[i]! += 1
    }
  }
  return sums.map((s, i) => (counts[i]! ? s / counts[i]! : 0))
}

/** Count items by an arbitrary key → sorted entries [key, count] (desc). */
export function countBy<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export function sumBy<T>(items: T[], key: (t: T) => string, value: (t: T) => number): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + value(it))
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

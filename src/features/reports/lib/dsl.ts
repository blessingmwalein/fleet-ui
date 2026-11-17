import type { Sums } from './types'

/** Sum of a measure. */
export const sm = (k: string) => (s: Sums) => s.m[k] ?? 0
/** a / b * mult (null when b is 0). */
export const rt = (a: string, b: string, mult = 1) => (s: Sums): number | null => {
  const d = s.m[b] ?? 0
  return d > 0 ? ((s.m[a] ?? 0) / d) * mult : null
}
/** Distinct count of a dimension. */
export const dc = (dim: string) => (s: Sums) => s.sets[dim]?.size ?? 0
/** Weighted average of a per-fact value stored as `sumKey` over `countKey`. */
export const avgOf = (sumKey: string, countKey: string) => rt(sumKey, countKey)

export const C = {
  green: 'var(--chart-1)',
  blue: 'var(--chart-2)',
  amber: 'var(--chart-3)',
  violet: 'var(--chart-4)',
  teal: 'var(--chart-5)',
  red: 'var(--chart-6)',
  grey: 'var(--chart-7)',
  pink: 'var(--chart-8)',
}

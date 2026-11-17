import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'
import { KM_TO_MI, L_TO_GAL, displayPrefs } from './displayPrefs'

export const toDate = (v: string | number | Date): Date => (v instanceof Date ? v : typeof v === 'number' ? new Date(v) : parseISO(v))

/** Default date/time patterns follow Administration → Settings → General (see `displayPrefs.ts`). */
const timePattern = () => (displayPrefs().timeFormat === '12h' ? 'hh:mm a' : 'HH:mm')

export function fmtDate(v: string | number | Date | null | undefined, pattern: string = displayPrefs().dateFormat) {
  if (v === null || v === undefined || v === '') return '—'
  const d = toDate(v)
  return isValid(d) ? format(d, pattern) : '—'
}

export const fmtDateTime = (v: string | number | Date | null | undefined) => fmtDate(v, `${displayPrefs().dateFormat}, ${timePattern()}`)
export const fmtTime = (v: string | number | Date | null | undefined) => fmtDate(v, timePattern())

export function timeAgo(v: string | number | Date | null | undefined) {
  if (v === null || v === undefined) return '—'
  const d = toDate(v)
  if (!isValid(d)) return '—'
  const secs = Math.abs(Date.now() - d.getTime()) / 1000
  if (secs < 10) return 'just now'
  return formatDistanceToNowStrict(d, { addSuffix: true })
}

export function fmtNumber(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtCompact(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(n)
}

export const fmtPct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`)
export const fmtKm = (n: number | null | undefined, digits = 0) => {
  if (n === null || n === undefined) return '—'
  return displayPrefs().distanceUnit === 'mi' ? `${fmtNumber(n * KM_TO_MI, digits)} mi` : `${fmtNumber(n, digits)} km`
}
export const fmtLitres = (n: number | null | undefined, digits = 0) => {
  if (n === null || n === undefined) return '—'
  return displayPrefs().volumeUnit === 'gal' ? `${fmtNumber(n * L_TO_GAL, digits)} gal` : `${fmtNumber(n, digits)} L`
}

export function fmtDuration(mins: number | null | undefined) {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return '—'
  const m = Math.round(Math.abs(mins))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${String(r).padStart(2, '0')}m`
}

/** USD formatter for non-reactive code. Components should prefer `useMoney()`. */
export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean; digits?: number } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const { compact, digits = 0 } = opts
  if (compact) {
    return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function titleCase(s: string) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function plural(n: number, one: string, many = one + 's') {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`
}

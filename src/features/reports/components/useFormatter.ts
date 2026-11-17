import { useMemo } from 'react'
import { fmtCompact, fmtDuration, fmtNumber } from '@/lib/format'
import { useMoney } from '@/hooks/useMoney'
import type { ValueKind } from '../lib/types'

export interface Formatted {
  text: string
  unit?: string
}

export interface Formatter {
  /** full text, e.g. "12,345 km" */
  (kind: ValueKind, v: number | string | null | undefined): string
  /** number and unit separated (for KPI tiles) */
  parts: (kind: ValueKind, v: number | string | null | undefined, compact?: boolean) => Formatted
  /** compact axis tick */
  axis: (kind: ValueKind) => (v: number) => string
}

/** Unit suffix used in CSV headers. */
export const CSV_UNIT: Partial<Record<ValueKind, string>> = { usd: 'USD', usd2: 'USD', pct: '%', pct1: '%', km: 'km', litres: 'L', hours: 'h', minutes: 'min' }

/** Value formatter bound to the display currency (re-created when the currency changes). */
export function useFormatter(): Formatter {
  const money = useMoney()
  return useMemo(() => {
    const parts = (kind: ValueKind, v: number | string | null | undefined, compact = false): Formatted => {
      if (v === null || v === undefined || v === '') return { text: '—' }
      if (typeof v === 'string') return { text: v }
      if (!Number.isFinite(v)) return { text: '—' }
      switch (kind) {
        case 'int': return { text: fmtNumber(v, 0) }
        case 'num1': return { text: fmtNumber(v, 1) }
        case 'num2': return { text: fmtNumber(v, 2) }
        case 'score': return { text: fmtNumber(v, 0) }
        case 'usd': return { text: money(v, compact && Math.abs(v) >= 10000 ? { compact: true } : undefined) }
        case 'usd2': return { text: money(v, { digits: 2 }) }
        case 'pct': return { text: `${fmtNumber(v, 0)}%` }
        case 'pct1': return { text: `${fmtNumber(v, 1)}%` }
        case 'km': return { text: fmtNumber(v, 0), unit: 'km' }
        case 'litres': return { text: fmtNumber(v, 0), unit: 'L' }
        case 'hours': return { text: fmtNumber(v, v < 100 ? 1 : 0), unit: 'h' }
        case 'minutes': return { text: fmtDuration(v) }
        default: return { text: String(v) }
      }
    }
    const f = ((kind: ValueKind, v: number | string | null | undefined) => {
      const p = parts(kind, v)
      return p.unit ? `${p.text} ${p.unit}` : p.text
    }) as Formatter
    f.parts = parts
    f.axis = (kind) => (v) => {
      switch (kind) {
        case 'usd': case 'usd2': return money(v, { compact: true })
        case 'pct': case 'pct1': return `${fmtNumber(v, 0)}%`
        case 'hours': return `${fmtCompact(v, 1)}h`
        case 'minutes': return `${fmtCompact(v, 0)}m`
        case 'num2': return fmtNumber(v, 1)
        default: return fmtCompact(v, 1)
      }
    }
    return f
  }, [money])
}

/** Raw value for CSV export (numbers rounded; strings untouched). */
export const csvValue = (v: number | string | null | undefined): string | number => (v === null || v === undefined ? '' : typeof v === 'number' ? Math.round(v * 100) / 100 : v)

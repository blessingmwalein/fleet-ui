import { useCallback } from 'react'
import { useSettings } from '@/store/settings'

export interface MoneyOptions {
  /** 1.2K / 3.4M style */
  compact?: boolean
  digits?: number
}

/** Formats a USD amount in the configured display currency (USD or ZiG). */
export function formatMoney(usd: number | null | undefined, currency: 'USD' | 'ZWG', rate: number, opts: MoneyOptions = {}) {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return '—'
  const value = currency === 'ZWG' ? usd * rate : usd
  const symbol = currency === 'ZWG' ? 'ZiG ' : '$'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (opts.compact) {
    return sign + symbol + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: abs < 1000 ? 0 : 1 }).format(abs)
  }
  const digits = opts.digits ?? 0
  return sign + symbol + abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * `const money = useMoney(); money(1234.5)` → "$1,235" (or "ZiG 33,085" when the display currency is ZWG).
 * All stored amounts are USD; conversion happens only at display time.
 */
export function useMoney() {
  const currency = useSettings((s) => s.currency)
  const rate = useSettings((s) => s.zwgRate)
  return useCallback((usd: number | null | undefined, opts?: MoneyOptions) => formatMoney(usd, currency, rate, opts), [currency, rate])
}

/** Currency code + rate, for forms/labels. */
export function useCurrency() {
  const currency = useSettings((s) => s.currency)
  const rate = useSettings((s) => s.zwgRate)
  return { currency, rate, symbol: currency === 'ZWG' ? 'ZiG' : '$' }
}

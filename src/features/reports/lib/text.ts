import { fmtDate, fmtDateTime } from '@/lib/format'

export const fmtDateLite = (iso: string | null | undefined) => fmtDate(iso, 'd MMM yyyy')
export const fmtDateTimeLite = (iso: string | null | undefined) => fmtDateTime(iso)

export const titleOf = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

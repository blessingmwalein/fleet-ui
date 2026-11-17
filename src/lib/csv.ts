export type CsvValue = string | number | boolean | null | undefined | Date

function esc(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
}

/** Triggers a browser download of a CSV file. UTF-8 BOM added so Excel opens it correctly. */
export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]) {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Convenience: export an array of objects using a column map {Header: (row) => value}. */
export function downloadObjectsCsv<T>(filename: string, rows: T[], columns: Record<string, (row: T) => CsvValue>) {
  const headers = Object.keys(columns)
  downloadCsv(
    filename,
    headers,
    rows.map((r) => headers.map((h) => columns[h]!(r))),
  )
}

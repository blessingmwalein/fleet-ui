import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/DataTable'
import { EntityLink } from '@/components/shared/EntityLink'
import { Status } from '@/components/shared/Status'
import { openEntity } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { CSV_UNIT, csvValue, useFormatter, type Formatter } from './useFormatter'
import type { ColSpec, ReportRow, TableSpec, Threshold } from '../lib/types'

function toneClass(v: number | string | null | undefined, t: Threshold | undefined): string {
  if (!t || typeof v !== 'number') return ''
  const good = t.invert ? v <= t.good : v >= t.good
  const warn = t.invert ? v <= t.warn : v >= t.warn
  return good ? 'text-success' : warn ? 'text-warning' : 'text-danger'
}

const isNumeric = (c: ColSpec) => c.kind !== 'text' && c.kind !== 'date' && c.kind !== 'datetime'

export function GroupCell({ row, compact }: { row: ReportRow; compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      {row.entity ? <EntityLink type={row.entity.type} id={row.entity.id} className="font-medium" /> : <span className="truncate font-medium">{row.label}</span>}
      {row.sub && !compact && <span className="truncate text-[11px] text-subtle-foreground">{row.sub}</span>}
    </div>
  )
}

function buildColumns(table: TableSpec, fmt: Formatter): ColumnDef<ReportRow, unknown>[] {
  const max = (key: string) => table.rows.reduce((m, r) => Math.max(m, Math.abs(Number(r.v[key]) || 0)), 0)
  const group: ColumnDef<ReportRow, unknown> = {
    id: '__group',
    header: table.groupLabel,
    size: table.id === 'main' ? 230 : 140,
    accessorFn: (r) => r.label,
    sortingFn: (a, b) => (a.original.sortKey ?? a.original.label).localeCompare(b.original.sortKey ?? b.original.label, undefined, { numeric: true }),
    meta: { label: table.groupLabel, exportValue: (r) => r.label },
    cell: ({ row }) => <GroupCell row={row.original} compact={table.id !== 'main'} />,
  }
  const cols = table.columns.map<ColumnDef<ReportRow, unknown>>((c) => {
    const numeric = isNumeric(c)
    const mx = c.bar ? (c.kind === 'pct' || c.kind === 'pct1' ? 100 : max(c.key)) : 0
    const unit = CSV_UNIT[c.kind]
    return {
      id: c.key,
      header: c.label,
      size: c.size ?? 110,
      accessorFn: (r) => r.v[c.key] ?? undefined,
      sortUndefined: 'last',
      sortingFn: numeric ? 'basic' : 'alphanumeric',
      meta: { label: unit ? `${c.label} (${unit})` : c.label, align: numeric ? 'right' : 'left', hideBelow: c.hideBelow, exportValue: (r) => csvValue(r.v[c.key]) },
      cell: ({ row }) => {
        const v = row.original.v[c.key]
        if (v === null || v === undefined) return <span className="text-subtle-foreground">—</span>
        if (c.status && typeof v === 'string') return <Status kind={c.status} value={v} />
        const text = fmt(c.kind, v)
        if (c.bar && typeof v === 'number' && mx > 0)
          return (
            <div className="flex flex-col items-end gap-1">
              <span className={cn('num leading-none', toneClass(v, c.tone))}>{text}</span>
              <span className="block h-[3px] w-full overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.max(2, (Math.abs(v) / mx) * 100))}%` }} /></span>
            </div>
          )
        return <span className={cn(numeric && 'num', toneClass(v, c.tone))} title={typeof v === 'string' ? v : undefined}>{text}</span>
      },
    }
  })
  return [group, ...cols]
}

export function ReportTable({ table, tableId, exportName, canExport, className }: { table: TableSpec; tableId: string; exportName: string; canExport: boolean; className?: string }) {
  const fmt = useFormatter()
  const columns = useMemo(() => buildColumns(table, fmt), [table, fmt])
  const total = table.totals
  const totalCols = total ? table.columns.filter((c) => isNumeric(c) && total[c.key] !== null && total[c.key] !== undefined) : []
  const compact = table.id !== 'main'
  return (
    <div className={cn('space-y-2', className)}>
      <div className="print:hidden">
        <DataTable<ReportRow>
          data={table.rows}
          columns={columns}
          tableId={tableId}
          getRowId={(r) => r.id}
          exportName={canExport ? exportName : undefined}
          searchPlaceholder={`Search ${table.groupLabel.toLowerCase()}…`}
          defaultSort={table.defaultSort ? [table.defaultSort] : undefined}
          defaultPageSize={compact ? 10 : 25}
          pageSizes={[10, 25, 50, 100]}
          onRowClick={table.clickable ? (r) => r.entity && openEntity(r.entity) : undefined}
          emptyTitle="No data for this selection"
          emptyDescription="Widen the date range or change the depot filter."
          mobileCard={(r) => <MobileCard row={r} table={table} fmt={fmt} />}
        />
        {!compact && totalCols.length > 0 && (
          <div className="panel mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5">
            <span className="label-xs">Totals</span>
            {totalCols.map((c) => (
              <div key={c.key} className="flex flex-col leading-tight">
                <span className="text-[11px] text-subtle-foreground">{c.label}</span>
                <span className={cn('num text-[13px] font-semibold', toneClass(total![c.key], c.tone))}>{fmt(c.kind, total![c.key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <PrintTable table={table} fmt={fmt} />
    </div>
  )
}

function MobileCard({ row, table, fmt }: { row: ReportRow; table: TableSpec; fmt: Formatter }) {
  const cols = table.columns.filter((c) => !c.status && row.v[c.key] !== null && row.v[c.key] !== undefined).slice(0, 6)
  return (
    <div className="space-y-2">
      <GroupCell row={row} />
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        {cols.map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="truncate text-[10.5px] uppercase tracking-wide text-subtle-foreground">{c.label}</dt>
            <dd className={cn('num truncate text-[13px] font-medium', toneClass(row.v[c.key], c.tone))}>{fmt(c.kind, row.v[c.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Full, unpaginated table shown only when printing. */
export function PrintTable({ table, fmt }: { table: TableSpec; fmt: Formatter }) {
  const sort = table.defaultSort
  const rows = useMemo(() => {
    if (!sort) return table.rows
    const get = (r: ReportRow) => (sort.id === '__group' ? (r.sortKey ?? r.label) : (r.v[sort.id] ?? null))
    return [...table.rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x === y) return 0
      if (x === null) return 1
      if (y === null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return sort.desc ? -c : c
    })
  }, [table.rows, sort])
  const cols = table.columns.filter((c) => !c.hideBelow || table.id === 'main')
  return (
    <div className="hidden print:block">
      <h3 className="mb-1 mt-3 text-[11px] font-semibold">{table.title}</h3>
      <table className="w-full border-collapse text-[8.5px]">
        <thead>
          <tr className="border-b border-black/40">
            <th className="py-1 pr-2 text-left font-semibold">{table.groupLabel}</th>
            {cols.map((c) => <th key={c.key} className={cn('px-1 py-1 font-semibold', isNumeric(c) ? 'text-right' : 'text-left')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="break-inside-avoid border-b border-black/10">
              <td className="py-0.5 pr-2 font-medium">{r.label}</td>
              {cols.map((c) => <td key={c.key} className={cn('px-1 py-0.5', isNumeric(c) && 'text-right')}>{fmt(c.kind, r.v[c.key] ?? null)}</td>)}
            </tr>
          ))}
          {table.totals && (
            <tr className="border-t border-black/50 font-semibold">
              <td className="py-1 pr-2">Total</td>
              {cols.map((c) => <td key={c.key} className={cn('px-1 py-1', isNumeric(c) && 'text-right')}>{isNumeric(c) ? fmt(c.kind, table.totals![c.key] ?? null) : ''}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

import type { ReactNode } from 'react'
import type { Invoice } from '@/types'
import { Badge, StatusDot } from '@/components/ui/display'
import { INVOICE_STATUS } from '@/config/status'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import { daysPastDue } from './lib'

const SUPPLIER_LABEL: Partial<Record<Invoice['status'], string>> = { draft: 'Pending approval', sent: 'Approved' }

/** Invoice status badge. Supplier invoices use payables wording (Pending approval / Approved). */
export function InvoiceStatusBadge({ status, kind = 'customer', className }: { status: Invoice['status']; kind?: Invoice['kind']; className?: string }) {
  const meta = INVOICE_STATUS[status]
  const label = kind === 'supplier' ? SUPPLIER_LABEL[status] ?? meta.label : meta.label
  return (
    <Badge tone={meta.tone} className={cn('gap-1.5', className)}>
      <StatusDot tone={meta.tone} className="size-1.5 [&>span]:size-1.5" />
      {label}
    </Badge>
  )
}

/** Due-date cell: red when overdue with the number of days. */
export function DueDate({ inv, now = Date.now() }: { inv: Invoice; now?: number }) {
  const dpd = daysPastDue(inv, now)
  return (
    <span className={cn('num', dpd > 0 && 'font-medium text-danger')} title={dpd > 0 ? `${dpd} days overdue` : undefined}>
      {fmtDate(inv.dueDate)}
      {dpd > 0 && <span className="ml-1.5 text-[11px]">{dpd}d</span>}
    </span>
  )
}

/** Compact inline statistic for summary strips above tables. */
export function Stat({ label, value, sub, tone, onClick, active }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'info'; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone && <StatusDot tone={tone} className="size-1.5 [&>span]:size-1.5" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="num mt-0.5 text-[17px] font-semibold leading-tight tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-subtle-foreground">{sub}</div>}
    </>
  )
  const cls = cn('panel min-w-0 px-3 py-2 text-left', onClick && 'cursor-pointer transition-colors hover:border-border-strong hover:bg-surface-2/60', active && 'border-primary/60 bg-primary/8')
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'outline-none focus-visible:ring-2 focus-visible:ring-ring/50')} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Signed money delta, e.g. "+$1,200" / "−$300". `badWhen` decides which direction is red. */
export function VarianceText({ value, format, badWhen = 'positive', className }: { value: number; format: (n: number) => string; badWhen?: 'positive' | 'negative'; className?: string }) {
  if (Math.abs(value) < 0.5) return <span className={cn('num text-muted-foreground', className)}>{format(0)}</span>
  const bad = badWhen === 'positive' ? value > 0 : value < 0
  return <span className={cn('num font-medium', bad ? 'text-danger' : 'text-success', className)}>{value > 0 ? '+' : '−'}{format(Math.abs(value))}</span>
}

/** Margin % with colour (green ≥ 15, amber 0–15, red < 0). */
export function MarginPct({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className="text-subtle-foreground">—</span>
  return <span className={cn('num font-medium', value < 0 ? 'text-danger' : value < 15 ? 'text-warning' : 'text-success', className)}>{value.toFixed(1)}%</span>
}

import type { ReactNode } from 'react'
import { Clock3, Copy, Gauge, Fuel, HelpCircle, Route, Droplets, type LucideIcon } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from '@/components/charts/charts'
import type { FuelTransaction } from '@/types'
import { Badge, type Tone } from '@/components/ui/display'
import { Tooltip } from '@/components/ui/overlays'
import { cn } from '@/lib/utils'
import { FUEL_RULES, type FlagState, type FuelRuleKey } from './lib'

export const RULE_ICON: Record<FuelRuleKey, LucideIcon> = {
  overfill: Droplets,
  odd_hours: Clock3,
  over_expected: Gauge,
  duplicate: Copy,
  odometer: Route,
  other: HelpCircle,
}

export const RULE_TONE: Record<FuelRuleKey, string> = {
  overfill: 'text-danger',
  odd_hours: 'text-warning',
  over_expected: 'text-danger',
  duplicate: 'text-warning',
  odometer: 'text-info',
  other: 'text-muted-foreground',
}

export const SEVERITY_TONE: Record<'low' | 'medium' | 'high', Tone> = { low: 'info', medium: 'warning', high: 'danger' }
export const SEVERITY_LABEL: Record<'low' | 'medium' | 'high', string> = { low: 'Low', medium: 'Medium', high: 'High' }

export const FLAG_STATE_LABEL: Record<FlagState, string> = { none: 'Clear', open: 'Open', reviewing: 'Under review', escalated: 'Escalated' }

/** Severity + rule badge for a flagged transaction ("—" when clear). */
export function FlagBadge({ flag, state, rule, compact }: { flag: FuelTransaction['flag']; state: FlagState; rule: FuelRuleKey | null; compact?: boolean }) {
  if (!flag) return <span className="text-subtle-foreground">—</span>
  const Icon = RULE_ICON[rule ?? 'other']
  const meta = FUEL_RULES[rule ?? 'other']
  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip content={flag.reason}>
        <Badge tone={SEVERITY_TONE[flag.severity]}>
          <Icon /> {compact ? SEVERITY_LABEL[flag.severity] : meta.short}
        </Badge>
      </Tooltip>
      {state === 'reviewing' && <Badge tone="info">Reviewing</Badge>}
      {state === 'escalated' && <Badge tone="primary">Escalated</Badge>}
    </span>
  )
}

export function ReconciledBadge({ reconciled }: { reconciled: boolean }) {
  return reconciled ? <Badge tone="success">Reconciled</Badge> : <Badge tone="neutral">Pending</Badge>
}

/** Diverging bar around a zero line: right = above benchmark/average, left = below. */
export function DeviationBar({ value, max = 40, goodWhen = 'down', className }: { value: number; max?: number; goodWhen?: 'down' | 'up'; className?: string }) {
  const width = Math.min(1, Math.abs(value) / max) * 50
  const good = goodWhen === 'down' ? value <= 0 : value >= 0
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} aria-hidden>
      <span className="absolute inset-y-0 left-1/2 z-10 w-px bg-border-strong" />
      <span
        className={cn('absolute inset-y-0 rounded-full', good ? 'bg-success' : 'bg-danger')}
        style={value >= 0 ? { left: '50%', width: `${Math.max(1.5, width)}%` } : { right: '50%', width: `${Math.max(1.5, width)}%` }}
      />
    </div>
  )
}

/** Tiny axis-less line chart whose y-domain hugs the data (prices vary by cents, so a zero baseline would hide the trend). */
export function PriceSpark({ data, color = 'var(--chart-2)', className }: { data: number[]; color?: string; className?: string }) {
  if (data.length < 2) return <span className="text-xs text-subtle-foreground">—</span>
  return (
    <div className={cn('h-7 w-24', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <YAxis hide domain={['dataMin - 0.01', 'dataMax + 0.01']} />
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Price-per-litre trend with a y-domain that hugs the data (cents-level movements vanish on a zero baseline). */
export function PriceTrendChart({ data, height = 180, money }: { data: { label: string; title: string; paid: number; list: number }[]; height?: number; money: (n: number, o?: { digits?: number }) => string }) {
  if (data.length < 2) return <div className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground" style={{ height }}>Not enough purchases to chart a trend</div>
  const values = data.flatMap((d) => [d.paid, d.list])
  const series = [
    { key: 'paid', label: 'Avg paid', format: (v: number) => money(v, { digits: 3 }) },
    { key: 'list', label: 'Diesel list price', format: (v: number) => money(v, { digits: 2 }) },
  ]
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={22} />
          <YAxis tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} domain={[Math.min(...values) - 0.03, Math.max(...values) + 0.03]} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <RTooltip cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }} content={<ChartTooltip series={series} labelFormatter={(l, p) => String((p[0]?.payload as { title?: string } | undefined)?.title ?? l)} />} />
          <Line type="monotone" dataKey="paid" name="Avg paid" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="list" name="Diesel list price" stroke="var(--chart-3)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Compact label/value tile used in drawers. */
export function Stat({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'warning' | 'success'; className?: string }) {
  return (
    <div className={cn('rounded-md border border-border bg-surface-2/50 px-3 py-2', className)}>
      <div className="label-xs">{label}</div>
      <div className={cn('num mt-0.5 text-[15px] font-semibold leading-tight', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success')}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-subtle-foreground">{hint}</div>}
    </div>
  )
}

export function StationMark({ className }: { className?: string }) {
  return <Fuel className={cn('size-3.5 text-muted-foreground', className)} />
}

/** Utilisation bar with threshold colouring (warning ≥ 85 %, danger ≥ 100 %). */
export function UtilisationBar({ pct, className }: { pct: number; className?: string }) {
  const tone = pct >= 100 ? 'bg-danger' : pct >= 85 ? 'bg-warning' : 'bg-primary'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 w-full min-w-10 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${Math.min(100, Math.max(1, pct))}%` }} />
      </div>
      <span className={cn('num w-9 shrink-0 text-right text-xs', pct >= 100 ? 'text-danger' : pct >= 85 ? 'text-warning' : 'text-muted-foreground')}>{Math.round(pct)}%</span>
    </div>
  )
}

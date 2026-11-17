import * as React from 'react'
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/shared/Page'

/** Categorical palette — theme-aware CSS variables (see index.css). Order is deliberate: green, blue, amber, violet, teal... */
export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-8)', 'var(--chart-7)', 'var(--chart-6)']
export const chartColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length]!

const axisTick = { fill: 'var(--chart-axis)', fontSize: 11 }

export interface Series {
  key: string
  label: string
  color?: string
  type?: 'area' | 'line' | 'bar'
  axis?: 'left' | 'right'
  stack?: string
  dashed?: boolean
  /** per-series value formatter for the tooltip */
  format?: (v: number) => string
  /** start hidden */
  hidden?: boolean
}

/** Hook for chart legends that toggle series visibility. */
export function useSeriesToggle(series: Series[]) {
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set(series.filter((s) => s.hidden).map((s) => s.key)))
  const toggle = React.useCallback((key: string) => setHidden((h) => {
    const n = new Set(h)
    if (n.has(key)) n.delete(key)
    else if (series.length - n.size > 1) n.add(key) // keep at least one visible
    return n
  }), [series.length])
  return { hidden, toggle }
}

export function SeriesLegend({ series, hidden, onToggle, className }: { series: Series[]; hidden: Set<string>; onToggle: (k: string) => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {series.map((s, i) => {
        const off = hidden.has(s.key)
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            aria-pressed={!off}
            className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors', off ? 'border-transparent text-subtle-foreground hover:text-foreground' : 'border-border bg-surface-2 text-foreground')}
          >
            <span className="size-2 rounded-[3px]" style={{ background: off ? 'var(--border-strong)' : (s.color ?? chartColor(i)) }} />
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

interface TooltipRow {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string
  payload?: Record<string, unknown>
}

export function ChartTooltip({ active, payload, label, series, labelFormatter, formatter, footer }: {
  active?: boolean
  payload?: TooltipRow[]
  label?: string | number
  series?: Series[]
  labelFormatter?: (label: string | number, payload: TooltipRow[]) => string
  formatter?: (v: number, name: string) => string
  footer?: (payload: TooltipRow[]) => React.ReactNode
}) {
  if (!active || !payload?.length) return null
  const head = labelFormatter ? labelFormatter(label ?? '', payload) : String(label ?? '')
  return (
    <div className="min-w-36 rounded-lg border border-border bg-popover px-2.5 py-2 text-xs shadow-pop">
      {head && <div className="mb-1.5 font-medium text-foreground">{head}</div>}
      <div className="space-y-1">
        {payload.map((p) => {
          const s = series?.find((x) => x.key === p.dataKey)
          const v = Number(p.value)
          const text = s?.format ? s.format(v) : formatter ? formatter(v, String(p.name)) : v.toLocaleString('en-US', { maximumFractionDigits: 1 })
          return (
            <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[3px]" style={{ background: p.color }} />
                {s?.label ?? p.name}
              </span>
              <span className="num font-medium text-foreground">{text}</span>
            </div>
          )
        })}
      </div>
      {footer && <div className="mt-1.5 border-t border-border pt-1.5">{footer(payload)}</div>}
    </div>
  )
}

/**
 * Time-series / category chart supporting area, line and bar series (mixed), dual axes, stacking and
 * click-to-toggle series. Pass rows like `{ label: '12 Oct', trips: 31, delayed: 4 }`.
 */
export function TimeSeriesChart({
  data, xKey = 'label', series, height = 240, yFormat, y2Format, xFormatter, titleKey, legend = true, stacked, className, empty = 'No data for this period',
}: {
  data: Record<string, unknown>[]
  xKey?: string
  series: Series[]
  height?: number
  yFormat?: (v: number) => string
  y2Format?: (v: number) => string
  xFormatter?: (v: string) => string
  /** field holding the long tooltip title (defaults to the x value) */
  titleKey?: string
  legend?: boolean
  stacked?: boolean
  className?: string
  empty?: string
}) {
  const { hidden, toggle } = useSeriesToggle(series)
  const uid = React.useId().replace(/:/g, '')
  const visible = series.filter((s) => !hidden.has(s.key))
  const hasRight = visible.some((s) => s.axis === 'right')
  const hasData = data.length > 0
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {legend && series.length > 1 && <SeriesLegend series={series} hidden={hidden} onToggle={toggle} />}
      <div style={{ height }} className="min-w-0">
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{empty}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: hasRight ? 4 : 8, bottom: 0, left: -8 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color ?? chartColor(i)} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={s.color ?? chartColor(i)} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
              <XAxis dataKey={xKey} tick={axisTick} axisLine={false} tickLine={false} minTickGap={22} tickMargin={6} tickFormatter={xFormatter} />
              <YAxis yAxisId="left" tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={yFormat} />
              {hasRight && <YAxis yAxisId="right" orientation="right" tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={y2Format ?? yFormat} />}
              <RTooltip
                cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
                content={<ChartTooltip series={series} labelFormatter={(l, p) => String((titleKey && (p[0]?.payload as Record<string, unknown> | undefined)?.[titleKey]) || l)} />}
              />
              {series.map((s, i) => {
                if (hidden.has(s.key)) return null
                const color = s.color ?? chartColor(i)
                const yAxisId = s.axis ?? 'left'
                const stackId = s.stack ?? (stacked ? 'a' : undefined)
                if (s.type === 'bar')
                  return <Bar key={s.key} yAxisId={yAxisId} dataKey={s.key} name={s.label} fill={color} stackId={stackId} radius={stackId ? 0 : [3, 3, 0, 0]} maxBarSize={26} isAnimationActive animationDuration={500} />
                if (s.type === 'line')
                  return <Line key={s.key} yAxisId={yAxisId} dataKey={s.key} name={s.label} stroke={color} strokeWidth={2} strokeDasharray={s.dashed ? '4 4' : undefined} dot={false} activeDot={{ r: 3.5 }} type="monotone" isAnimationActive animationDuration={600} />
                return (
                  <Area key={s.key} yAxisId={yAxisId} dataKey={s.key} name={s.label} stroke={color} strokeWidth={2} fill={`url(#${uid}-${s.key})`} stackId={stackId} type="monotone" dot={false} activeDot={{ r: 3.5 }} isAnimationActive animationDuration={600} />
                )
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export interface DonutDatum {
  name: string
  value: number
  color?: string
}

/** Donut with centre label and an interactive legend (hover highlights the segment). */
export function DonutChart({ data, height = 180, centerLabel, centerValue, format = (v) => v.toLocaleString('en-US'), className, legendCols = 1 }: {
  data: DonutDatum[]
  height?: number
  centerLabel?: string
  centerValue?: React.ReactNode
  format?: (v: number) => string
  className?: string
  legendCols?: 1 | 2
}) {
  const [active, setActive] = React.useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  // Memoise by value so frequent parent re-renders (live telemetry) don't restart Recharts' entry animation.
  const signature = data.map((d) => `${d.name}:${d.value}:${d.color ?? ''}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colored = React.useMemo(() => data.map((d, i) => ({ ...d, color: d.color ?? chartColor(i) })), [signature])
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3', className)}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={colored} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="94%" paddingAngle={total ? 2 : 0} stroke="none" startAngle={90} endAngle={-270} onMouseEnter={(_, i) => setActive(i)} onMouseLeave={() => setActive(null)} animationDuration={600}>
              {colored.map((d, i) => (
                <Cell key={d.name} fill={d.color} opacity={active === null || active === i ? 1 : 0.35} style={{ transition: 'opacity 150ms' }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="num text-lg font-semibold leading-none">{active !== null ? format(colored[active]!.value) : (centerValue ?? format(total))}</span>
          <span className="mt-1 max-w-[70%] truncate text-[11px] text-muted-foreground">{active !== null ? colored[active]!.name : (centerLabel ?? 'Total')}</span>
        </div>
      </div>
      <ul className={cn('grid min-w-[9rem] flex-1 gap-x-4 gap-y-1', legendCols === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {colored.map((d, i) => (
          <li key={d.name} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} className={cn('flex items-center justify-between gap-3 rounded px-1 py-0.5 text-xs transition-colors', active === i && 'bg-accent')}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-[3px]" style={{ background: d.color }} />
              <span className="truncate text-muted-foreground">{d.name}</span>
            </span>
            <span className="num shrink-0 font-medium">
              {format(d.value)} <span className="text-subtle-foreground">{total ? `${Math.round((d.value / total) * 100)}%` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface BarListItem {
  label: React.ReactNode
  value: number
  sub?: React.ReactNode
  color?: string
  onClick?: () => void
}

/** Ranked horizontal bars — top vehicles, cost by category, etc. */
export function BarList({ items, format = (v) => v.toLocaleString('en-US'), max, className, emptyText = 'No data' }: { items: BarListItem[]; format?: (v: number) => string; max?: number; className?: string; emptyText?: string }) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1)
  if (!items.length) return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((it, i) => (
        <li key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">
              {it.onClick ? <button type="button" onClick={it.onClick} className="truncate text-left hover:text-primary hover:underline">{it.label}</button> : it.label}
              {it.sub && <span className="ml-1.5 text-subtle-foreground">{it.sub}</span>}
            </span>
            <span className="num shrink-0 font-medium">{format(it.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, (it.value / m) * 100)}%`, background: it.color ?? chartColor(0) }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Axis-less mini area chart. */
export function Sparkline({ data, color = 'var(--chart-1)', height = 32, className }: { data: number[]; color?: string; height?: number; className?: string }) {
  const id = React.useId().replace(/:/g, '')
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Panel wrapper for charts: title, description, right-side controls (segmented controls, selects). */
export function ChartCard({ title, description, actions, children, className, bodyClassName }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <Panel title={title} description={description} actions={actions} className={className} bodyClassName={bodyClassName}>
      {children}
    </Panel>
  )
}

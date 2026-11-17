import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'
import { StatusDot, type Tone } from '@/components/ui/display'
import { Tooltip } from '@/components/ui/overlays'
import { Skeleton } from '@/components/ui/form-controls'

/** Count-up number — animates whenever `value` changes. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-US'), duration = 0.7, className }: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => format(v))
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: 'easeOut' })
    return () => controls.stop()
  }, [value, duration, mv])
  return <motion.span className={cn('num', className)}>{text}</motion.span>
}

export interface Delta {
  /** percentage change vs previous period (e.g. 4.2 for +4.2%) */
  pct: number
  /** whether an increase is good (default) or bad (e.g. cost, incidents) */
  goodWhen?: 'up' | 'down'
  label?: string
}

export function pctChange(current: number, previous: number): number {
  if (!previous) return current ? 100 : 0
  return ((current - previous) / Math.abs(previous)) * 100
}

export function DeltaChip({ delta, className }: { delta: Delta; className?: string }) {
  const up = delta.pct > 0.05
  const down = delta.pct < -0.05
  const good = delta.goodWhen === 'down' ? down : up
  const bad = delta.goodWhen === 'down' ? up : down
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium num', good ? 'text-success' : bad ? 'text-danger' : 'text-muted-foreground', className)}>
      <Icon className="size-3.5" />
      {Math.abs(delta.pct).toFixed(1)}%
    </span>
  )
}

export interface KpiCardProps {
  label: string
  /** numeric value is animated and formatted with `format` */
  value: number | string
  format?: (n: number) => string
  unit?: string
  delta?: Delta
  /** secondary line shown when there is no `delta` (e.g. "62% of fleet") */
  sub?: ReactNode
  /** short series for the sparkline */
  spark?: number[]
  sparkColor?: string
  status?: Tone
  icon?: LucideIcon
  /** hover content: previous value, peak, definition… */
  hint?: ReactNode
  href?: string
  onClick?: () => void
  loading?: boolean
  className?: string
}

export function KpiCard({ label, value, format, unit, delta, sub, spark, sparkColor = 'var(--chart-1)', status, icon: Icon, hint, href, onClick, loading, className }: KpiCardProps) {
  const interactive = !!href || !!onClick
  const body = (
    <div className={cn('panel group relative flex h-full min-w-0 flex-col justify-between gap-1.5 p-3 transition-colors', interactive && 'hover:border-border-strong hover:bg-surface-2/60', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="size-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
        </span>
        {status && <StatusDot tone={status} pulse={status === 'danger'} />}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-[22px] font-semibold leading-none tracking-tight">{typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}</span>
              {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
            </div>
            {delta && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <DeltaChip delta={delta} />
                <span className="truncate text-[11px] text-subtle-foreground">{delta.label ?? 'vs prev. period'}</span>
              </div>
            )}
            {!delta && sub && <div className="mt-1.5 truncate text-[11px] text-subtle-foreground">{sub}</div>}
          </div>
          {spark && spark.length > 1 && (
            <div className="h-9 w-20 shrink-0 sm:w-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`spark-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#spark-${label.replace(/\W/g, '')})`} isAnimationActive={false} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  )
  const wrapped = href ? (
    <Link to={href} className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{body}</Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className="block h-full w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{body}</button>
  ) : (
    body
  )
  return hint ? <Tooltip content={hint} side="bottom" delay={300}><div className="h-full">{wrapped}</div></Tooltip> : wrapped
}

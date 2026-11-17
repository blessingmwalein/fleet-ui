import { useWatch } from 'react-hook-form'
import { cn } from '@/lib/utils'
import type { AnyForm } from '@/components/forms/fields'
import { expiryState } from '@/config/status'
import { scoreColor } from './driverData'

/** Circular safety-score gauge (green >=85, amber 70-84, red <70). */
export function ScoreRing({ score, size = 64, stroke = 6, caption = 'Safety', className }: { score: number; size?: number; stroke?: number; caption?: string | null; className?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} role="img" aria-label={`Safety score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray 700ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-semibold leading-none" style={{ fontSize: Math.round(size * 0.3) }}>{score}</span>
        {caption && size >= 56 && <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-subtle-foreground">{caption}</span>}
      </div>
    </div>
  )
}

/** Compact bar + number used in tables. */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: scoreColor(score) }} />
      </div>
      <span className="num w-6 text-[13px] font-medium" style={{ color: scoreColor(score) }}>{score}</span>
    </div>
  )
}

/** Live hint under a date input: "Expired 12d ago" / "Expires in 9 days" / "Valid for 214 days". */
export function ExpiryNote({ form, name }: { form: AnyForm; name: string }) {
  const value = useWatch({ control: form.control, name }) as string | undefined
  if (!value) return null
  const e = expiryState(`${value}T23:59:59`)
  if (e.state === 'unknown') return null
  if (e.state === 'expired') return <span className="text-danger">Already expired {-e.days} day{e.days === -1 ? '' : 's'} ago</span>
  if (e.state === 'expiring') return <span className="text-warning">Expires in {e.days} day{e.days === 1 ? '' : 's'} — renewal due soon</span>
  return <span className="text-success">Valid for {e.days} more days</span>
}

/** Small label/value stat used inside cards. */
export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="label-xs mb-0.5">{label}</div>
      <div className="num truncate text-[15px] font-semibold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

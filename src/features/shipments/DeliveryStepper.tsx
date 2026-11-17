import { AlertTriangle, Check, ShieldCheck } from 'lucide-react'
import type { Shipment } from '@/types'
import { Timeline, type TimelineItem } from '@/components/shared/Page'
import { cn } from '@/lib/utils'
import { fmtDateTime } from '@/lib/format'
import { exceptionMilestones, isOpenException, reachedIndex, stageMilestones, STAGE_LABEL, STAGE_SHORT, STAGES } from './shipmentLib'

/** Stage index at which an exception was raised (last stage stamped on/before it). */
function stageAt(s: Shipment, iso: string | null) {
  if (!iso) return reachedIndex(s)
  const t = new Date(iso).getTime()
  let idx = 0
  stageMilestones(s).forEach((m, i) => {
    if (m.at && new Date(m.at).getTime() <= t + 1000) idx = i
  })
  return idx
}

/**
 * Delivery timeline: horizontal stepper on md+ screens, vertical timeline on phones.
 * Exceptions are rendered inline — as chips under the stage they interrupted (desktop) or as events in the sequence (mobile).
 */
export function DeliveryStepper({ shipment: s }: { shipment: Shipment }) {
  const stages = stageMilestones(s)
  const reached = reachedIndex(s)
  const delivered = s.status === 'delivered'
  const open = isOpenException(s)
  const excs = exceptionMilestones(s).filter((m) => !m.label.startsWith('Exception resolved'))

  const mobileItems: (TimelineItem & { sort: number })[] = [
    ...stages.map((m, i) => ({
      id: m.key,
      title: STAGE_LABEL[STAGES[i]!],
      description: m.note,
      time: m.at ? fmtDateTime(m.at) : 'Pending',
      done: i <= reached,
      sort: m.at ? new Date(m.at).getTime() : 1e15 + i,
    })),
    ...exceptionMilestones(s).map((m, i) => {
      const resolved = m.label.startsWith('Exception resolved')
      return { id: `exc-${i}`, title: m.label, description: m.note, time: fmtDateTime(m.at), done: true, tone: resolved ? ('default' as const) : ('danger' as const), icon: resolved ? undefined : <AlertTriangle className="size-3" />, sort: m.at ? new Date(m.at).getTime() + 1 : 0 }
    }),
  ].sort((a, b) => a.sort - b.sort)

  return (
    <div>
      {/* desktop stepper */}
      <ol className="hidden grid-cols-6 md:grid" aria-label="Delivery progress">
        {stages.map((m, i) => {
          const done = i < reached || (i === reached && delivered)
          const current = i === reached && !delivered
          const here = excs.filter((e) => stageAt(s, e.at) === i)
          return (
            <li key={m.key} className="relative flex min-w-0 flex-col items-center px-1.5 text-center" aria-current={current ? 'step' : undefined}>
              {i < stages.length - 1 && <span aria-hidden className={cn('absolute left-1/2 top-3.5 h-0.5 w-full -translate-y-1/2', i < reached ? 'bg-primary' : 'bg-border')} />}
              <span
                className={cn(
                  'relative z-10 flex size-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-colors',
                  done && 'border-primary bg-primary text-primary-foreground',
                  current && !open && 'border-primary bg-card text-primary ring-4 ring-primary/15',
                  current && open && 'border-danger bg-card text-danger ring-4 ring-danger/15',
                  !done && !current && 'border-border-strong bg-card text-subtle-foreground',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : current && open ? <AlertTriangle className="size-3.5" /> : i + 1}
              </span>
              <p className={cn('mt-2 text-[13px] font-medium leading-tight', !done && !current && 'text-muted-foreground')}>{STAGE_SHORT[STAGES[i]!]}</p>
              <p className="num mt-0.5 text-xs text-muted-foreground">{m.at ? fmtDateTime(m.at) : current ? 'In progress' : 'Pending'}</p>
              {m.note && <p className="mt-1 line-clamp-2 max-w-[11rem] text-[11px] leading-snug text-subtle-foreground" title={m.note}>{m.note}</p>}
              {here.map((e, k) => {
                const resolved = !(open && e.at === s.exception?.raisedAt)
                return (
                  <span key={k} title={e.note} className={cn('mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', resolved ? 'border-border bg-surface-3 text-muted-foreground' : 'border-danger/30 bg-danger/12 text-danger')}>
                    {resolved ? <ShieldCheck className="size-3 shrink-0" /> : <AlertTriangle className="size-3 shrink-0" />}
                    <span className="truncate">{e.label.replace('Exception – ', '')}</span>
                  </span>
                )
              })}
            </li>
          )
        })}
      </ol>

      {/* mobile timeline */}
      <div className="md:hidden">
        <Timeline items={mobileItems} />
      </div>
    </div>
  )
}

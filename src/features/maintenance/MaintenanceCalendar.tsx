import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { Panel } from '@/components/shared/Page'
import { Plate } from '@/components/shared/Status'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import type { ScheduleRow, WoRow } from './lib/data'

type CalKind = 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'due' | 'overdue'
interface CalEvent {
  key: string
  day: string
  kind: CalKind
  reg: string
  title: string
  woId?: string
  scheduleId?: string
  continued?: boolean
}

const dayKey = (d: Date | string) => format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd')

const KIND: Record<CalKind, { label: string; chip: string; dot: string; style?: React.CSSProperties }> = {
  requested: { label: 'Requested', chip: 'border-border-strong bg-surface-3 text-muted-foreground', dot: 'bg-subtle-foreground' },
  scheduled: { label: 'Scheduled', chip: 'border-info/30 bg-info/12 text-info', dot: 'bg-info' },
  in_progress: { label: 'In workshop', chip: 'border-warning/30 bg-warning/12 text-warning', dot: 'bg-warning' },
  completed: { label: 'Completed', chip: 'border-success/30 bg-success/10 text-success', dot: 'bg-success' },
  due: { label: 'Service due', chip: 'border-transparent', dot: '', style: { color: 'var(--chart-4)', background: 'color-mix(in oklab, var(--chart-4) 14%, transparent)', borderColor: 'color-mix(in oklab, var(--chart-4) 35%, transparent)' } },
  overdue: { label: 'Overdue service', chip: 'border-danger/40 bg-danger/15 text-danger', dot: 'bg-danger' },
}
type Filter = 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'due'
const FILTER_OF: Record<CalKind, Filter> = { requested: 'requested', scheduled: 'scheduled', in_progress: 'in_progress', completed: 'completed', due: 'due', overdue: 'due' }

function Dot({ kind }: { kind: CalKind }) {
  return <span className={cn('size-1.5 rounded-full', KIND[kind].dot)} style={kind === 'due' ? { background: 'var(--chart-4)' } : undefined} />
}

export function MaintenanceCalendar({ workOrders, schedules, onOpenWo, onSchedule, canCreate }: { workOrders: WoRow[]; schedules: ScheduleRow[]; onOpenWo: (id: string) => void; onSchedule: (date: string) => void; canCreate: boolean }) {
  const navigate = useNavigate()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [view, setView] = useState<'month' | 'agenda'>('month')
  const [shown, setShown] = useState<Record<Filter, boolean>>({ requested: true, scheduled: true, in_progress: true, completed: true, due: true })
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }), [month])

  const byDay = useMemo(() => {
    const first = days[0]!
    const last = days[days.length - 1]!
    const today = startOfDay(new Date())
    const map = new Map<string, CalEvent[]>()
    const push = (e: CalEvent) => {
      if (!shown[FILTER_OF[e.kind]]) return
      const list = map.get(e.day) ?? []
      list.push(e)
      map.set(e.day, list)
    }
    for (const w of workOrders) {
      if (w.status === 'cancelled') continue
      const base = { reg: w.reg, title: w.title, woId: w.id }
      if (w.status === 'in_progress') {
        const from = startOfDay(new Date(w.startedAt ?? w.scheduledDate))
        for (let d = from, i = 0; d <= today && i < 60; d = addDays(d, 1), i++) {
          if (d >= first && d <= last) push({ ...base, key: `${w.id}-${dayKey(d)}`, day: dayKey(d), kind: 'in_progress', continued: i > 0 })
        }
      } else {
        const date = w.status === 'completed' ? w.completedAt ?? w.scheduledDate : w.scheduledDate
        const d = new Date(date)
        if (d >= first && d <= addDays(last, 1)) push({ ...base, key: w.id, day: dayKey(d), kind: w.status === 'requested' ? 'requested' : w.status === 'completed' ? 'completed' : 'scheduled' })
      }
    }
    for (const s of schedules) {
      if (s.openWoId) continue
      const d = new Date(s.nextDueDate)
      if (d >= first && d <= addDays(last, 1)) push({ key: s.id, day: dayKey(d), kind: s.state === 'overdue' ? 'overdue' : 'due', reg: s.reg, title: s.task, scheduleId: s.id })
    }
    return map
  }, [days, workOrders, schedules, shown])

  const monthEvents = useMemo(() => [...byDay.entries()].filter(([k]) => isSameMonth(new Date(k), month)).sort(([a], [b]) => a.localeCompare(b)), [byDay, month])
  const total = monthEvents.reduce((s, [, l]) => s + l.length, 0)
  const unbooked = schedules.filter((s) => s.state === 'overdue' && !s.openWoId).length
  const dayEvents = selectedDay ? byDay.get(dayKey(selectedDay)) ?? [] : []

  const open = (e: CalEvent) => {
    if (e.woId) onOpenWo(e.woId)
    else if (e.scheduleId) navigate(`/maintenance/schedules?open=${e.scheduleId}`)
  }

  const Chip = ({ e, compact }: { e: CalEvent; compact?: boolean }) => (
    <button
      type="button"
      onClick={(ev) => { ev.stopPropagation(); open(e) }}
      title={`${e.reg} — ${e.title} (${KIND[e.kind].label})`}
      className={cn('flex w-full items-center gap-1 truncate rounded border px-1 py-px text-left text-[11px] leading-4 transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 outline-none', KIND[e.kind].chip, compact && 'py-0.5')}
      style={KIND[e.kind].style}
    >
      <span className="shrink-0 font-mono font-medium">{e.continued ? '↳ ' : ''}{e.reg}</span>
      <span className="truncate opacity-80">{e.title}</span>
    </button>
  )

  return (
    <Panel
      title={<span className="num">{format(month, 'MMMM yyyy')}</span>}
      description={`${total} event${total === 1 ? '' : 's'} this month`}
      actions={
        <>
          <Segmented<'month' | 'agenda'> aria-label="Calendar view" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight /></Button>
        </>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        {(Object.keys(shown) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={shown[f]}
            onClick={() => setShown((s) => ({ ...s, [f]: !s[f] }))}
            className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors', shown[f] ? 'border-border bg-surface-2 text-foreground' : 'border-transparent text-subtle-foreground hover:text-foreground')}
          >
            <Dot kind={f} />
            {KIND[f].label}
          </button>
        ))}
        <span className="inline-flex items-center gap-1.5 px-1.5 text-[11px] text-subtle-foreground"><Dot kind="overdue" /> Overdue</span>
        {unbooked > 0 && <Link to="/maintenance/schedules" className="ml-auto text-[11px] font-medium text-danger hover:underline">{unbooked} overdue service{unbooked > 1 ? 's' : ''} not booked →</Link>}
      </div>

      {view === 'month' ? (
        <div>
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const events = byDay.get(dayKey(d)) ?? []
              const inMonth = isSameMonth(d, month)
              const hasOverdue = events.some((e) => e.kind === 'overdue')
              return (
                <div
                  key={d.toISOString()}
                  role="button"
                  tabIndex={0}
                  aria-label={`${format(d, 'EEEE d MMMM')}, ${events.length} events`}
                  onClick={() => setSelectedDay(d)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedDay(d)}
                  className={cn(
                    'min-h-[56px] cursor-pointer border-b border-r border-border/70 p-1 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 sm:min-h-[104px]',
                    (i + 1) % 7 === 0 && 'border-r-0', i >= days.length - 7 && 'border-b-0', !inMonth && 'bg-surface-2/40', hasOverdue && 'bg-danger/5',
                  )}
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className={cn('num flex size-5 items-center justify-center rounded-full text-[11px]', isToday(d) ? 'bg-primary font-semibold text-primary-foreground' : inMonth ? 'text-foreground' : 'text-subtle-foreground')}>{format(d, 'd')}</span>
                    {events.length > 0 && <span className="num text-[10px] text-subtle-foreground sm:hidden">{events.length}</span>}
                  </div>
                  <div className="hidden space-y-0.5 sm:block">
                    {events.slice(0, 3).map((e) => <Chip key={e.key} e={e} />)}
                    {events.length > 3 && <p className="px-1 text-[11px] font-medium text-muted-foreground">+{events.length - 3} more</p>}
                  </div>
                  <div className="flex flex-wrap gap-0.5 sm:hidden">{events.slice(0, 4).map((e) => <Dot key={e.key} kind={e.kind} />)}</div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto">
          {monthEvents.length === 0 ? <EmptyState compact title="Nothing planned this month" description="Adjust the legend filters or browse another month." /> : (
            monthEvents.map(([k, list]) => (
              <div key={k} className="border-b border-border/70 last:border-0">
                <div className="sticky top-0 flex items-center justify-between bg-surface-2/90 px-3.5 py-1.5 backdrop-blur">
                  <span className={cn('text-xs font-semibold', isToday(new Date(k)) && 'text-primary')}>{format(new Date(k), 'EEEE d MMMM')}{isToday(new Date(k)) && ' · Today'}</span>
                  <span className="num text-[11px] text-subtle-foreground">{list.length}</span>
                </div>
                <ul className="space-y-1 px-3.5 py-2">{list.map((e) => <li key={e.key}><Chip e={e} compact /></li>)}</ul>
              </div>
            ))
          )}
        </div>
      )}

      <Sheet open={!!selectedDay} onOpenChange={(o) => !o && setSelectedDay(null)}>
        <SheetContent size="sm">
          <SheetHeader>
            <SheetTitle>{selectedDay ? format(selectedDay, 'EEEE d MMMM yyyy') : ''}</SheetTitle>
            <SheetDescription>{dayEvents.length} maintenance event{dayEvents.length === 1 ? '' : 's'}{selectedDay && isSameDay(selectedDay, new Date()) ? ' · today' : ''}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {dayEvents.length === 0 ? (
              <EmptyState compact icon={CalendarPlus} title="Nothing scheduled" description="No work orders or service due dates fall on this day." />
            ) : (
              <ul className="space-y-2">
                {dayEvents.map((e) => (
                  <li key={e.key}>
                    <button type="button" onClick={() => { setSelectedDay(null); open(e) }} className="flex w-full items-start gap-2.5 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent/40">
                      <span className="mt-1.5"><Dot kind={e.kind} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2"><Plate>{e.reg}</Plate><span className="text-[11px] text-muted-foreground">{KIND[e.kind].label}</span></span>
                        <span className="block truncate text-[13px]">{e.title}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>
          {canCreate && selectedDay && startOfDay(selectedDay) >= startOfDay(new Date()) && (
            <SheetFooter><Button onClick={() => { const d = selectedDay; setSelectedDay(null); onSchedule(dayKey(d)) }}><CalendarPlus /> Request maintenance for this day</Button></SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </Panel>
  )
}

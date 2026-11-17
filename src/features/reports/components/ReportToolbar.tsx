import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { Building2, CalendarDays, Check, RotateCcw } from 'lucide-react'
import { RANGE_PRESETS } from '@/hooks/useFilters'
import type { Granularity } from '@/lib/analytics'
import { useDb } from '@/store/db'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Label, Switch } from '@/components/ui/form-controls'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Segmented } from '@/components/ui/segmented'
import type { ReportSpec } from '../lib/types'

export interface ReportState {
  /** `global` follows the top-bar range; otherwise a range preset */
  range: string
  from: string
  to: string
  /** `global` follows the top-bar depot; `all` or a branch id overrides it */
  branch: string
  group: string
  metric: string
  gran: 'auto' | Granularity
  compare: boolean
  off: string[]
}

/** Report filters live in the URL so a report view can be shared, bookmarked and restored from the centre. */
export function useReportState(spec: ReportSpec) {
  const [params, setParams] = useSearchParams()
  const state = useMemo<ReportState>(() => {
    const group = params.get('group')
    const metric = params.get('metric')
    return {
      range: params.get('range') ?? 'global',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      branch: params.get('branch') ?? 'global',
      group: group && (group === 'period' || spec.dims.some((d) => d.value === group)) ? group : spec.defaultGroup,
      metric: metric && spec.metrics.includes(metric) ? metric : spec.defaultMetric,
      gran: (['day', 'week', 'month'].includes(params.get('gran') ?? '') ? params.get('gran') : 'auto') as ReportState['gran'],
      compare: params.get('cmp') !== '0',
      off: (params.get('off') ?? '').split(',').filter(Boolean),
    }
  }, [params, spec])

  const set = useCallback(
    (patch: Partial<ReportState>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const apply = (key: string, value: string | null) => (value === null || value === '' ? next.delete(key) : next.set(key, value))
          if ('range' in patch) {
            apply('range', patch.range === 'global' ? null : patch.range!)
            if (patch.range !== 'custom') {
              next.delete('from')
              next.delete('to')
            }
          }
          if ('from' in patch) apply('from', patch.from ?? null)
          if ('to' in patch) apply('to', patch.to ?? null)
          if ('branch' in patch) apply('branch', patch.branch === 'global' ? null : patch.branch!)
          if ('group' in patch) apply('group', patch.group === spec.defaultGroup ? null : patch.group!)
          if ('metric' in patch) apply('metric', patch.metric === spec.defaultMetric ? null : patch.metric!)
          if ('gran' in patch) apply('gran', patch.gran === 'auto' ? null : patch.gran!)
          if ('compare' in patch) apply('cmp', patch.compare ? null : '0')
          if ('off' in patch) apply('off', patch.off!.join(','))
          return next
        },
        { replace: true },
      )
    },
    [setParams, spec],
  )

  const reset = useCallback(() => setParams({}, { replace: true }), [setParams])
  const dirty = params.toString() !== ''
  return { state, set, reset, dirty, search: params.toString() }
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="label-xs">{label}</span>
      {children}
    </div>
  )
}

export function ReportToolbar({
  spec, state, set, reset, dirty, windowLabel, globalLabel, globalBranch, metricLabels,
}: {
  spec: ReportSpec
  state: ReportState
  set: (p: Partial<ReportState>) => void
  reset: () => void
  dirty: boolean
  windowLabel: string
  globalLabel: string
  globalBranch: string
  metricLabels: Record<string, string>
}) {
  const branches = useDb((s) => s.branches)
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(state.from || format(new Date(Date.now() - 29 * 864e5), 'yyyy-MM-dd'))
  const [to, setTo] = useState(state.to || format(new Date(), 'yyyy-MM-dd'))
  const metricOptions = spec.metrics.map((m) => ({ value: m, label: metricLabels[m] ?? m }))
  const following = state.range === 'global'

  return (
    <div className="panel flex flex-wrap items-end gap-x-4 gap-y-3 p-3 print:hidden" role="group" aria-label="Report controls">
      <Field label="Period">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-44 justify-start gap-1.5 px-2.5" aria-label={`Report period: ${windowLabel}`}>
              <CalendarDays className="text-muted-foreground" />
              <span className="truncate">{windowLabel}</span>
              {following && <span className="ml-auto rounded bg-surface-3 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Global</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5">
            <button type="button" onClick={() => { set({ range: 'global' }); setOpen(false) }} className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent', following && 'text-primary')}>
              <span>Follow global filter <span className="text-xs text-muted-foreground">({globalLabel})</span></span>
              {following && <Check className="size-3.5" />}
            </button>
            <div className="label-xs px-2 pb-1 pt-2">Override for this report</div>
            {RANGE_PRESETS.filter((p) => p.value !== 'custom').map((p) => (
              <button key={p.value} type="button" onClick={() => { set({ range: p.value }); setOpen(false) }} className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] outline-none hover:bg-accent', state.range === p.value && 'text-primary')}>
                {p.label}
                {state.range === p.value && <Check className="size-3.5" />}
              </button>
            ))}
            <div className="mt-1 border-t border-border p-2">
              <div className="label-xs mb-1.5">Custom range</div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="rp-from" className="mb-1">From</Label><Input id="rp-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
                <div><Label htmlFor="rp-to" className="mb-1">To</Label><Input id="rp-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
              </div>
              <Button size="sm" className="mt-2 w-full" disabled={!from || !to || from > to} onClick={() => { set({ range: 'custom', from, to }); setOpen(false) }}>Apply range</Button>
            </div>
          </PopoverContent>
        </Popover>
      </Field>

      <Field label="Depot">
        <Select value={state.branch} onValueChange={(v) => set({ branch: v })}>
          <SelectTrigger className="w-52 gap-1.5" aria-label="Depot filter">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="min-w-56">
            <SelectItem value="global">Global filter ({globalBranch})</SelectItem>
            <SelectItem value="all">All depots</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Group by">
        <Select value={state.group} onValueChange={(v) => set({ group: v })}>
          <SelectTrigger className="w-44" aria-label="Group by"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            {spec.dims.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Metric">
        {metricOptions.length <= 4 ? (
          <Segmented size="md" aria-label="Metric" options={metricOptions} value={state.metric} onChange={(v) => set({ metric: v })} />
        ) : (
          <Select value={state.metric} onValueChange={(v) => set({ metric: v })}>
            <SelectTrigger className="w-44" aria-label="Metric"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">{metricOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </Field>

      <Field label="Chart interval">
        <Segmented
          size="md"
          aria-label="Chart interval"
          value={state.gran}
          onChange={(v) => set({ gran: v })}
          options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
        />
      </Field>

      {spec.toggles && (
        <Field label="Include">
          <div className="flex h-8 flex-wrap items-center gap-x-3">
            {spec.toggles.map((t) => {
              const on = !state.off.includes(t.key)
              return (
                <label key={t.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={on} onCheckedChange={(v) => set({ off: v ? state.off.filter((k) => k !== t.key) : [...state.off, t.key] })} aria-label={t.label} />
                  {t.label}
                </label>
              )
            })}
          </div>
        </Field>
      )}

      <div className="ml-auto flex items-end gap-3">
        <label className="flex h-8 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={state.compare} onCheckedChange={(v) => set({ compare: v })} aria-label="Compare with previous period" />
          vs previous period
        </label>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={reset} className="h-8">
            <RotateCcw /> Reset
          </Button>
        )}
      </div>
    </div>
  )
}

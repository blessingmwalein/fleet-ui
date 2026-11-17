import { useMemo } from 'react'
import type { LiveState } from '@/types'
import { useDb } from '@/store/db'
import { LIVE_STATE, VEHICLE_CATEGORY } from '@/config/status'
import { fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ChartCard, DonutChart } from '@/components/charts/charts'
import { Skeleton } from '@/components/ui/form-controls'
import { Tooltip } from '@/components/ui/overlays'
import { useDash } from '../hooks/useDashboardScope'
import { LIVE_ORDER, useFleetLive } from '../hooks/useFleetLive'
import { MiniStat, ViewAll } from './panel-kit'

function StateBar({ counts, total }: { counts: Record<LiveState, number>; total: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3">
      {LIVE_ORDER.map((s) =>
        counts[s] ? (
          <Tooltip key={s} content={`${LIVE_STATE[s].label}: ${counts[s]}`}>
            <div className="h-full transition-[width] duration-700" style={{ width: `${(counts[s] / total) * 100}%`, background: LIVE_STATE[s].color }} />
          </Tooltip>
        ) : null,
      )}
    </div>
  )
}

export function AvailabilityChart() {
  const live = useFleetLive()
  const { isAll } = useDash()
  const branches = useDb((s) => s.branches)

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; counts: Record<LiveState, number>; total: number }>()
    for (const r of live.rows) {
      const key = isAll ? r.vehicle.branchId : r.vehicle.category
      const name = isAll ? (branches.find((b) => b.id === key)?.name.replace(/ (Head Office & Main )?Depot$/, '') ?? key) : VEHICLE_CATEGORY[r.vehicle.category]
      let g = m.get(key)
      if (!g) m.set(key, (g = { name, counts: { moving: 0, idle: 0, stopped: 0, maintenance: 0, offline: 0 }, total: 0 }))
      g.counts[r.state]++
      g.total++
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 5)
  }, [live.rows, isAll, branches])

  // memoised on the counts so the donut doesn't replay its entry animation on every simulator tick
  const key = LIVE_ORDER.map((s) => live.counts[s]).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => LIVE_ORDER.map((s) => ({ name: LIVE_STATE[s].label, value: live.counts[s], color: LIVE_STATE[s].color })), [key])

  return (
    <ChartCard
      title="Fleet availability"
      description="Live operational state of every vehicle"
      className="h-full"
      actions={<ViewAll to="/tracking">Live map</ViewAll>}
    >
      {!live.ready ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <div className="flex h-full flex-col gap-3">
          <DonutChart data={data} height={148} centerLabel="vehicles" centerValue={fmtNumber(live.total)} className="gap-x-4" />
          <div className="flex gap-5 border-t border-border pt-2.5">
            <MiniStat label="Available" value={`${live.availablePct.toFixed(0)}%`} tone={live.availablePct >= 85 ? 'success' : live.availablePct >= 70 ? 'warning' : 'danger'} />
            <MiniStat label="Active now" value={live.active} />
            <MiniStat label="Unavailable" value={live.counts.maintenance + live.counts.offline} />
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 border-t border-border pt-2.5">
            <div className="label-xs">{isAll ? 'By depot' : 'By category'}</div>
            {groups.map((g) => (
              <div key={g.name} className="grid grid-cols-[minmax(0,7.5rem)_1fr_1.75rem] items-center gap-2 text-xs">
                <span className="truncate text-muted-foreground">{g.name}</span>
                <StateBar counts={g.counts} total={g.total} />
                <span className={cn('num text-right font-medium')}>{g.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  )
}

import { useMemo, useState } from 'react'
import { bucketIndex, sumByBucket } from '@/lib/analytics'
import { toDate } from '@/lib/format'
import { ChartCard, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { Segmented } from '@/components/ui/segmented'
import { sum } from '../lib/periodStats'
import { useDash } from '../hooks/useDashboardScope'
import { useGranularity } from '../hooks/useGranularity'
import { MiniStat, StatRow, ViewAll } from './panel-kit'

/** A completed trip counts as delayed when it finished more than this many minutes late. */
const LATE_MIN = 15

export function TripsChart() {
  const { trend, trips } = useDash()
  const { g, setG, options, buckets } = useGranularity()
  const [mode, setMode] = useState<'stacked' | 'grouped'>('stacked')

  const { rows, onTime, late, rate, delayedNow } = useMemo(() => {
    const done = trips.filter((t) => t.status === 'completed' && t.actualEnd && trend.inRange(t.actualEnd))
    const ok = sumByBucket(done.filter((t) => t.delayMinutes <= LATE_MIN), buckets, (t) => t.actualEnd)
    const lt = sumByBucket(done.filter((t) => t.delayMinutes > LATE_MIN), buckets, (t) => t.actualEnd)
    // trips that are delayed right now are attributed to the period they were due to finish in
    const now = trips.filter((t) => t.status === 'delayed')
    for (const t of now) {
      let i = bucketIndex(buckets, toDate(t.plannedEnd).getTime())
      if (i < 0) i = toDate(t.plannedEnd).getTime() < buckets[0]!.start ? 0 : buckets.length - 1
      lt[i]! += 1
    }
    const data = buckets.map((b, i) => {
      const tot = ok[i]! + lt[i]!
      return { label: b.label, title: b.title, onTime: ok[i]!, late: lt[i]!, rate: tot ? Math.round((ok[i]! / tot) * 1000) / 10 : null }
    })
    const o = sum(ok)
    const l = sum(lt)
    return { rows: data, onTime: o, late: l, rate: o + l ? (o / (o + l)) * 100 : 0, delayedNow: now.length }
  }, [trips, trend, buckets])

  const series: Series[] = [
    { key: 'onTime', label: 'On time', type: 'bar', color: 'var(--chart-1)' },
    { key: 'late', label: 'Delayed', type: 'bar', color: 'var(--chart-6)' },
    { key: 'rate', label: 'On-time rate', type: 'line', axis: 'right', color: 'var(--chart-2)', format: (v) => `${v.toFixed(1)}%` },
  ]

  return (
    <ChartCard
      title="Trips completed vs delayed"
      description={`Completed trips and delays (>${LATE_MIN} min late or currently delayed), per ${g}${trend.extended ? ' · last 7 days' : ''}`}
      className="h-full"
      actions={
        <>
          <Segmented size="xs" aria-label="Bar layout" value={mode} onChange={setMode} options={[{ value: 'stacked', label: 'Stacked' }, { value: 'grouped', label: 'Grouped' }]} />
          <Segmented size="xs" aria-label="Granularity" value={g} onChange={setG} options={options} className="hidden sm:inline-flex" />
          <ViewAll to="/reports/trip-performance" />
        </>
      }
    >
      <StatRow>
        <MiniStat label="Completed" value={onTime + late - delayedNow} />
        <MiniStat label="Delayed" value={late} tone={late ? 'warning' : undefined} />
        <MiniStat label="On-time rate" value={`${rate.toFixed(1)}%`} tone={rate >= 85 ? 'success' : rate >= 70 ? 'warning' : 'danger'} />
        <MiniStat label="Delayed now" value={delayedNow} tone={delayedNow ? 'danger' : undefined} />
      </StatRow>
      <TimeSeriesChart data={rows} series={series} stacked={mode === 'stacked'} height={216} titleKey="title" y2Format={(v) => `${v}%`} />
    </ChartCard>
  )
}

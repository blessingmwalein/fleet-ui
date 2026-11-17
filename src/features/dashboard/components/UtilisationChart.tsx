import { useMemo, useState } from 'react'
import { bucketIndex } from '@/lib/analytics'
import { fmtNumber, toDate } from '@/lib/format'
import { ChartCard, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { Segmented } from '@/components/ui/segmented'
import { mean, statsBetween } from '../lib/periodStats'
import { useDash } from '../hooks/useDashboardScope'
import { useGranularity } from '../hooks/useGranularity'
import { MiniStat, StatRow, ViewAll } from './panel-kit'

type Metric = 'pct' | 'vehicles'

export function UtilisationChart() {
  const { trend, dailyStats } = useDash()
  const { g, setG, options, buckets } = useGranularity()
  const [metric, setMetric] = useState<Metric>('pct')

  const { rows, avg, peak, low } = useMemo(() => {
    const stats = statsBetween(dailyStats, trend.from, trend.to)
    const acc = buckets.map(() => ({ util: [] as number[], active: [] as number[], inService: [] as number[] }))
    for (const s of stats) {
      const i = bucketIndex(buckets, toDate(s.date).getTime())
      if (i < 0) continue
      acc[i]!.util.push(s.utilisationPct)
      acc[i]!.active.push(s.activeVehicles)
      acc[i]!.inService.push(s.inService)
    }
    const avgAll = mean(stats.map((s) => s.utilisationPct))
    const out = buckets.map((b, i) => ({
      label: b.label,
      title: b.title,
      util: Math.round(mean(acc[i]!.util) * 10) / 10,
      avg: Math.round(avgAll * 10) / 10,
      active: Math.round(mean(acc[i]!.active) * 10) / 10,
      inService: Math.round(mean(acc[i]!.inService) * 10) / 10,
      has: acc[i]!.util.length > 0,
    }))
    const filled = out.filter((r) => r.has)
    const hi = filled.reduce<(typeof out)[number] | null>((m, r) => (!m || r.util > m.util ? r : m), null)
    const lo = filled.reduce<(typeof out)[number] | null>((m, r) => (!m || r.util < m.util ? r : m), null)
    return { rows: filled, avg: avgAll, peak: hi, low: lo }
  }, [dailyStats, trend, buckets])

  const series: Series[] =
    metric === 'pct'
      ? [
          { key: 'util', label: 'Utilisation', type: 'area', color: 'var(--chart-1)', format: (v) => `${v.toFixed(1)}%` },
          { key: 'avg', label: 'Period average', type: 'line', color: 'var(--chart-2)', format: (v) => `${v.toFixed(1)}%` },
        ]
      : [
          { key: 'active', label: 'Active vehicles', type: 'area', color: 'var(--chart-1)', format: (v) => v.toFixed(1) },
          { key: 'inService', label: 'In-service vehicles', type: 'line', color: 'var(--chart-2)', format: (v) => v.toFixed(1) },
        ]

  return (
    <ChartCard
      title="Fleet utilisation"
      description={`Share of in-service vehicles active, per ${g}${trend.extended ? ' · last 7 days' : ''}`}
      className="h-full"
      actions={
        <>
          <Segmented size="xs" aria-label="Metric" value={metric} onChange={setMetric} options={[{ value: 'pct', label: 'Utilisation %' }, { value: 'vehicles', label: 'Active vs in service' }]} />
          <Segmented size="xs" aria-label="Granularity" value={g} onChange={setG} options={options} className="hidden sm:inline-flex" />
          <ViewAll to="/reports/fleet-utilisation" />
        </>
      }
    >
      <StatRow>
        <MiniStat label="Average" value={`${avg.toFixed(1)}%`} tone={avg >= 70 ? 'success' : avg >= 50 ? 'warning' : 'danger'} />
        <MiniStat label={peak ? `Peak · ${peak.label}` : 'Peak'} value={peak ? `${peak.util.toFixed(1)}%` : '—'} />
        <MiniStat label={low ? `Lowest · ${low.label}` : 'Lowest'} value={low ? `${low.util.toFixed(1)}%` : '—'} />
        <MiniStat label="In service (latest)" value={rows.length ? fmtNumber(rows[rows.length - 1]!.inService) : '—'} />
      </StatRow>
      <TimeSeriesChart data={rows} series={series} height={268} titleKey="title" />
    </ChartCard>
  )
}

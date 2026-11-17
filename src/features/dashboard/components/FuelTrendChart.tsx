import { useMemo } from 'react'
import { sumByBucket } from '@/lib/analytics'
import { fmtNumber } from '@/lib/format'
import { useMoney } from '@/hooks/useMoney'
import { ChartCard, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { Segmented } from '@/components/ui/segmented'
import { sum } from '../lib/periodStats'
import { useDash } from '../hooks/useDashboardScope'
import { useGranularity } from '../hooks/useGranularity'
import { MiniStat, StatRow, ViewAll } from './panel-kit'

export function FuelTrendChart() {
  const { trend, fuel, trips } = useDash()
  const money = useMoney()
  const { g, setG, options, buckets } = useGranularity()

  const { rows, litres, cost, perL, l100 } = useMemo(() => {
    const inWin = fuel.filter((f) => trend.inRange(f.date))
    const lit = sumByBucket(inWin, buckets, (f) => f.date, (f) => f.litres)
    const usd = sumByBucket(inWin, buckets, (f) => f.date, (f) => f.totalUsd)
    const totalL = sum(lit)
    const totalUsd = sum(usd)
    const km = sum(trips.filter((t) => t.status === 'completed' && trend.inRange(t.actualEnd)).map((t) => t.actualDistanceKm ?? 0))
    return {
      rows: buckets.map((b, i) => ({ label: b.label, title: b.title, litres: Math.round(lit[i]!), cost: Math.round(usd[i]!) })),
      litres: totalL,
      cost: totalUsd,
      perL: totalL ? totalUsd / totalL : 0,
      l100: km ? (totalL / km) * 100 : 0,
    }
  }, [fuel, trips, trend, buckets])

  const series: Series[] = [
    { key: 'litres', label: 'Litres', type: 'bar', axis: 'left', color: 'var(--chart-3)', format: (v) => `${fmtNumber(v)} L` },
    { key: 'cost', label: 'Fuel cost', type: 'line', axis: 'right', color: 'var(--chart-2)', format: (v) => money(v) },
  ]

  return (
    <ChartCard
      title="Fuel consumption trend"
      description={`Litres dispensed and spend, per ${g}${trend.extended ? ' · last 7 days' : ''}`}
      className="h-full"
      actions={
        <>
          <Segmented size="xs" aria-label="Granularity" value={g} onChange={setG} options={options} />
          <ViewAll to="/fuel" />
        </>
      }
    >
      <StatRow>
        <MiniStat label="Total litres" value={`${fmtNumber(litres)} L`} />
        <MiniStat label="Fuel spend" value={money(cost)} />
        <MiniStat label="Avg price / L" value={perL ? money(perL, { digits: 2 }) : '—'} />
        <MiniStat label="Fleet economy" value={l100 ? `${l100.toFixed(1)} L/100km` : '—'} />
      </StatRow>
      <TimeSeriesChart data={rows} series={series} height={216} titleKey="title" yFormat={(v) => fmtNumber(v)} y2Format={(v) => money(v, { compact: true })} />
    </ChartCard>
  )
}

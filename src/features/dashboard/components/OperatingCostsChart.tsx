import { useMemo } from 'react'
import type { ExpenseCategory } from '@/types'
import { sumByBucket } from '@/lib/analytics'
import { fmtNumber } from '@/lib/format'
import { useMoney } from '@/hooks/useMoney'
import { ChartCard, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { Segmented } from '@/components/ui/segmented'
import { sum, workOrderCost } from '../lib/periodStats'
import { useDash } from '../hooks/useDashboardScope'
import { useGranularity } from '../hooks/useGranularity'
import { MiniStat, StatRow, ViewAll } from './panel-kit'

const OTHER: ExpenseCategory[] = ['insurance', 'parking', 'fines', 'licensing', 'other']

export function OperatingCostsChart() {
  const { trend, fuel, workOrders, expenses, trips } = useDash()
  const money = useMoney()
  const { g, setG, options, buckets } = useGranularity()

  const { rows, total, parts, perKm } = useMemo(() => {
    const live = expenses.filter((e) => e.status !== 'rejected' && trend.inRange(e.date))
    const byCat = (cats: ExpenseCategory[]) => live.filter((e) => cats.includes(e.category))
    const fuelTx = fuel.filter((f) => trend.inRange(f.date))
    const done = workOrders.filter((w) => w.status === 'completed' && trend.inRange(w.completedAt))

    const fuelCost = sumByBucket(fuelTx, buckets, (f) => f.date, (f) => f.totalUsd)
    const fuelCash = sumByBucket(byCat(['fuel']), buckets, (e) => e.date, (e) => e.amountUsd)
    const maint = sumByBucket(done, buckets, (w) => w.completedAt, workOrderCost)
    const maintExp = sumByBucket(byCat(['maintenance', 'tyres']), buckets, (e) => e.date, (e) => e.amountUsd)
    const toll = sumByBucket(byCat(['toll']), buckets, (e) => e.date, (e) => e.amountUsd)
    const allowance = sumByBucket(byCat(['allowance']), buckets, (e) => e.date, (e) => e.amountUsd)
    const other = sumByBucket(byCat(OTHER), buckets, (e) => e.date, (e) => e.amountUsd)

    const data = buckets.map((b, i) => ({
      label: b.label,
      title: b.title,
      fuel: Math.round(fuelCost[i]! + fuelCash[i]!),
      maintenance: Math.round(maint[i]! + maintExp[i]!),
      toll: Math.round(toll[i]!),
      allowance: Math.round(allowance[i]!),
      other: Math.round(other[i]!),
    }))
    const sums = { fuel: sum(data.map((d) => d.fuel)), maintenance: sum(data.map((d) => d.maintenance)), toll: sum(data.map((d) => d.toll)), allowance: sum(data.map((d) => d.allowance)), other: sum(data.map((d) => d.other)) }
    const tot = sum(Object.values(sums))
    const km = sum(trips.filter((t) => t.status === 'completed' && trend.inRange(t.actualEnd)).map((t) => t.actualDistanceKm ?? 0))
    return { rows: data, total: tot, parts: sums, perKm: km ? tot / km : 0 }
  }, [expenses, fuel, workOrders, trips, trend, buckets])

  const series: Series[] = [
    { key: 'fuel', label: 'Fuel', type: 'bar', color: 'var(--chart-3)', format: (v) => money(v) },
    { key: 'maintenance', label: 'Maintenance & tyres', type: 'bar', color: 'var(--chart-2)', format: (v) => money(v) },
    { key: 'toll', label: 'Tolls', type: 'bar', color: 'var(--chart-5)', format: (v) => money(v) },
    { key: 'allowance', label: 'Driver allowances', type: 'bar', color: 'var(--chart-4)', format: (v) => money(v) },
    { key: 'other', label: 'Other', type: 'bar', color: 'var(--chart-7)', format: (v) => money(v) },
  ]

  return (
    <ChartCard
      title="Vehicle operating costs"
      description={`Fuel, maintenance, tolls, allowances and other, per ${g}${trend.extended ? ' · last 7 days' : ''}`}
      className="h-full"
      actions={
        <>
          <Segmented size="xs" aria-label="Granularity" value={g} onChange={setG} options={options} />
          <ViewAll to="/reports/operating-expenses" />
        </>
      }
    >
      <StatRow>
        <MiniStat label="Total cost" value={money(total)} />
        <MiniStat label="Fuel share" value={total ? `${Math.round((parts.fuel / total) * 100)}%` : '—'} />
        <MiniStat label="Maintenance" value={money(parts.maintenance, { compact: true })} />
        <MiniStat label="Cost per km" value={perKm ? money(perKm, { digits: 2 }) : '—'} />
        <MiniStat label="Km driven" value={fmtNumber(sum(trips.filter((t) => t.status === 'completed' && trend.inRange(t.actualEnd)).map((t) => t.actualDistanceKm ?? 0)))} />
      </StatRow>
      <TimeSeriesChart data={rows} series={series} stacked height={216} titleKey="title" yFormat={(v) => money(v, { compact: true })} />
    </ChartCard>
  )
}

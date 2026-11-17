import { useMemo, useState } from 'react'
import { BarList, ChartCard, DonutChart, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { Segmented } from '@/components/ui/segmented'
import { openEntity } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useFormatter } from './useFormatter'
import type { ChartSpec } from '../lib/types'

const SPAN = { 1: '', 2: 'lg:col-span-2', 3: 'lg:col-span-2 xl:col-span-3' } as const
const XL_SPAN = { 1: 'xl:col-span-1', 2: 'xl:col-span-2', 3: 'xl:col-span-3' } as const

export function ReportChart({ spec }: { spec: ChartSpec }) {
  const cls = cn(SPAN[spec.span], XL_SPAN[spec.span], 'break-inside-avoid')
  if (spec.type === 'trend') return <TrendCard spec={spec} className={cls} />
  if (spec.type === 'ranking') return <RankingCard spec={spec} className={cls} />
  return <ShareCard spec={spec} className={cls} />
}

function TrendCard({ spec, className }: { spec: Extract<ChartSpec, { type: 'trend' }>; className?: string }) {
  const fmt = useFormatter()
  const series = useMemo<Series[]>(
    () => spec.series.map((s) => ({ key: s.key, label: s.label, type: s.type, axis: s.axis, color: s.color, dashed: s.dashed, format: (v: number) => fmt(s.kind, v) })),
    [spec.series, fmt],
  )
  const left = spec.series.find((s) => s.axis === 'left') ?? spec.series[0]!
  const right = spec.series.find((s) => s.axis === 'right')
  return (
    <ChartCard title={spec.title} description={spec.description} className={className}>
      <TimeSeriesChart data={spec.data} series={series} height={236} stacked={spec.stacked} titleKey="title" yFormat={fmt.axis(left.kind)} y2Format={right ? fmt.axis(right.kind) : undefined} />
    </ChartCard>
  )
}

function RankingCard({ spec, className }: { spec: Extract<ChartSpec, { type: 'ranking' }>; className?: string }) {
  const fmt = useFormatter()
  const [order, setOrder] = useState<'top' | 'bottom'>('top')
  const items = useMemo(() => {
    const all = spec.fixedOrder ? spec.items : order === 'top' ? spec.items : [...spec.items].reverse()
    return all.slice(0, spec.limit)
  }, [spec, order])
  return (
    <ChartCard
      title={spec.title}
      description={spec.description}
      className={className}
      actions={
        spec.fixedOrder ? null : (
          <Segmented size="xs" aria-label="Ranking order" value={order} onChange={setOrder} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} />
        )
      }
    >
      <BarList
        items={items.map((it, i) => ({
          label: it.label,
          sub: it.sub,
          value: it.value,
          color: spec.fixedOrder ? (i === 0 ? 'var(--chart-1)' : i === 1 ? 'var(--chart-3)' : 'var(--chart-6)') : undefined,
          onClick: it.entity ? () => openEntity(it.entity!) : undefined,
        }))}
        max={Math.max(...items.map((i) => Math.abs(i.value)), 1)}
        format={(v) => fmt(spec.kind, v)}
        emptyText="No data for this selection"
      />
    </ChartCard>
  )
}

function ShareCard({ spec, className }: { spec: Extract<ChartSpec, { type: 'share' }>; className?: string }) {
  const fmt = useFormatter()
  const total = spec.data.reduce((s, d) => s + d.value, 0)
  return (
    <ChartCard title={spec.title} description={spec.description} className={className}>
      {spec.data.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">No data for this selection</p>
      ) : (
        <DonutChart data={spec.data} height={150} centerLabel={spec.centerLabel} centerValue={fmt.parts(spec.kind, total, true).text} format={(v) => fmt(spec.kind, v)} />
      )}
    </ChartCard>
  )
}

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, Droplets, Flag, Fuel, Gauge, Plus, Route, Tag, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/shared/EmptyState'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { DriverLink, VehicleLink } from '@/components/shared/EntityLink'
import { BarList, ChartCard, TimeSeriesChart } from '@/components/charts/charts'
import { useDb } from '@/store/db'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { autoGranularity, bucketIndex, makeBuckets, sumBy, type Granularity } from '@/lib/analytics'
import { downloadObjectsCsv } from '@/lib/csv'
import { fmtCompact, fmtDateTime, fmtNumber } from '@/lib/format'
import { VEHICLE_CATEGORY } from '@/config/status'
import { cn } from '@/lib/utils'
import { DeviationBar, FlagBadge, RULE_ICON, RULE_TONE, SEVERITY_TONE } from './components'
import { FlagActionButtons, useFlagActions } from './FlagActions'
import { useFuelPerms, useFuelRows } from './hooks'
import { aggregateEfficiency, avgPrice, explainFlag, FUEL_RULES, groupRows, severityRank, vehicleEfficiency, type FuelRow, type FuelRuleKey } from './lib'

const RULE_KEYS: FuelRuleKey[] = ['overfill', 'over_expected', 'duplicate', 'odd_hours', 'odometer']

const SEV_BAR = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-info' } as const

export default function FuelOverviewPage() {
  const money = useMoney()
  const range = useDateRange()
  const { scope, isAll, branch } = useBranchScope()
  const perms = useFuelPerms()
  const navigate = useNavigate()
  const rows = useFuelRows()
  const branches = useDb((s) => s.branches)
  const flags = useFlagActions()

  const [granOverride, setGranOverride] = useState<Granularity | null>(null)
  const [vehicleView, setVehicleView] = useState<'best' | 'worst'>('worst')
  const [priceView, setPriceView] = useState<'brand' | 'city'>('brand')
  const [queueScope, setQueueScope] = useState<'range' | 'all'>('range')
  const [ruleFilter, setRuleFilter] = useState<FuelRuleKey | null>(null)

  const scoped = useMemo(() => scope(rows), [rows, scope])
  const cur = useMemo(() => scoped.filter((r) => range.inRange(r.date)), [scoped, range])
  const prev = useMemo(() => scoped.filter((r) => range.inPrevRange(r.date)), [scoped, range])

  const gran = granOverride ?? autoGranularity(range.days)
  const buckets = useMemo(() => makeBuckets(range.from, range.to, gran), [range, gran])

  const kpi = useMemo(() => {
    const sum = (list: FuelRow[]) => {
      let litres = 0
      let spend = 0
      let flagged = 0
      for (const r of list) {
        litres += r.litres
        spend += r.totalUsd
        if (r.flag) flagged++
      }
      return { litres, spend, price: litres ? spend / litres : 0, flagged, eff: aggregateEfficiency(list) }
    }
    return { cur: sum(cur), prev: sum(prev) }
  }, [cur, prev])

  const series = useMemo(() => {
    const per = buckets.map(() => ({ litres: 0, spend: 0, rl: 0, rk: 0, rs: 0, flagged: 0 }))
    for (const r of cur) {
      const i = bucketIndex(buckets, new Date(r.date).getTime())
      if (i < 0) continue
      const b = per[i]!
      b.litres += r.litres
      b.spend += r.totalUsd
      if (r.flag) b.flagged++
      if (r.reliable && r.distanceKm) {
        b.rl += r.litres
        b.rk += r.distanceKm
        b.rs += r.totalUsd
      }
    }
    return per
  }, [buckets, cur])

  const trend = useMemo(() => buckets.map((b, i) => ({ label: b.label, title: b.title, litres: Math.round(series[i]!.litres), spend: Math.round(series[i]!.spend) })), [buckets, series])

  const categoryEff = useMemo(() => {
    const out: { key: string; label: string; l100: number; benchmark: number; fills: number }[] = []
    for (const [cat, list] of groupRows(cur, (r) => r.category ?? 'service')) {
      const a = aggregateEfficiency(list)
      if (a.l100 === null || a.fills < 2) continue
      out.push({ key: cat, label: VEHICLE_CATEGORY[cat], l100: a.l100, benchmark: list[0]!.benchmark, fills: a.fills })
    }
    return out.sort((a, b) => b.benchmark - a.benchmark)
  }, [cur])

  const vehicleRank = useMemo(() => {
    const list = vehicleEfficiency(cur).sort((a, b) => a.deltaPct - b.deltaPct)
    return vehicleView === 'best' ? list.slice(0, 7) : list.slice(-7).reverse()
  }, [cur, vehicleView])

  const costPerKm = useMemo(() => {
    const byBranch = isAll
    const groups = groupRows(cur, (r) => (byBranch ? r.branchId : r.category ?? 'service'))
    const out: { label: string; value: number; sub: string }[] = []
    for (const [k, list] of groups) {
      const a = aggregateEfficiency(list)
      if (a.costPerKm === null || a.fills < 2) continue
      const label = byBranch ? (branches.find((b) => b.id === k)?.name ?? k).replace(/ (Head Office & Main )?Depot$/, '') : VEHICLE_CATEGORY[k as keyof typeof VEHICLE_CATEGORY]
      out.push({ label, value: a.costPerKm, sub: `${fmtNumber(a.km)} km` })
    }
    return out.sort((a, b) => b.value - a.value)
  }, [cur, isAll, branches])

  const priceRows = useMemo(() => {
    const fleet = avgPrice(cur)
    const out: { label: string; price: number; delta: number; pct: number; litres: number }[] = []
    for (const [k, list] of groupRows(cur, (r) => (priceView === 'brand' ? r.brand : r.city))) {
      const p = avgPrice(list)
      out.push({ label: k, price: p, delta: p - fleet, pct: fleet ? ((p - fleet) / fleet) * 100 : 0, litres: list.reduce((a, r) => a + r.litres, 0) })
    }
    return out.sort((a, b) => a.price - b.price)
  }, [cur, priceView])

  const stationSpend = useMemo(() => {
    const byId = new Map(cur.map((r) => [r.stationId, r]))
    const litres = new Map<string, number>()
    for (const r of cur) litres.set(r.stationId, (litres.get(r.stationId) ?? 0) + r.litres)
    return sumBy(cur, (r) => r.stationId, (r) => r.totalUsd).slice(0, 8).map(([id, v]) => ({ id, value: v, name: byId.get(id)!.stationName, city: byId.get(id)!.city, litres: litres.get(id) ?? 0 }))
  }, [cur])

  const queue = useMemo(() => {
    const base = (queueScope === 'range' ? cur : scoped).filter((r) => r.flag)
    return base
  }, [cur, scoped, queueScope])
  const queueRuleCounts = useMemo(() => {
    const m = new Map<FuelRuleKey, number>()
    for (const r of queue) m.set(r.rule ?? 'other', (m.get(r.rule ?? 'other') ?? 0) + 1)
    return m
  }, [queue])
  const queueShown = useMemo(
    () => queue.filter((r) => !ruleFilter || r.rule === ruleFilter).sort((a, b) => Number(a.flagState === 'escalated') - Number(b.flagState === 'escalated') || severityRank(b.flag!.severity) - severityRank(a.flag!.severity) || b.date.localeCompare(a.date)),
    [queue, ruleFilter],
  )
  const openCount = kpi.cur.flagged ? cur.filter((r) => r.flagState === 'open').length : 0
  const reviewingCount = cur.filter((r) => r.flagState === 'reviewing').length
  const escalatedCount = cur.filter((r) => r.flagState === 'escalated').length

  const exportCsv = () =>
    downloadObjectsCsv(`fuel-transactions-${range.preset}`, cur, {
      Ref: (r) => r.ref, Date: (r) => r.date, Vehicle: (r) => r.reg, Driver: (r) => r.driverName, Station: (r) => r.stationName, Litres: (r) => r.litres, 'Price per litre (USD)': (r) => r.pricePerLitreUsd,
      'Total (USD)': (r) => r.totalUsd, 'Odometer (km)': (r) => r.odometerKm, 'L/100 km': (r) => (r.l100 === null ? '' : Number(r.l100.toFixed(1))), Flag: (r) => r.flag?.reason ?? '', Reconciled: (r) => (r.reconciled ? 'Yes' : 'No'),
    })

  const maxCat = Math.max(1, ...categoryEff.flatMap((c) => [c.l100, c.benchmark])) * 1.05
  const sparkOf = (f: (i: number) => number) => series.map((_, i) => f(i))

  return (
    <Page>
      <PageHeader
        title="Fuel management"
        description={`Consumption, spend and anomaly detection · ${range.label}${isAll ? '' : ` · ${branch?.name}`}`}
        actions={
          <>
            {perms.canExport && (
              <Button variant="outline" onClick={exportCsv} disabled={!cur.length}>
                <Download /> Export CSV
              </Button>
            )}
            {perms.canCreate && (
              <Button asChild>
                <Link to="/fuel/transactions?new=1"><Plus /> Add transaction</Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Litres purchased" icon={Droplets} value={kpi.cur.litres} format={(n) => fmtNumber(n)} unit="L" delta={{ pct: pctChange(kpi.cur.litres, kpi.prev.litres), goodWhen: 'down' }} spark={sparkOf((i) => series[i]!.litres)} hint={`Previous period: ${fmtNumber(kpi.prev.litres)} L`} />
        <KpiCard label="Fuel spend" icon={Wallet} value={kpi.cur.spend} format={(n) => money(n)} delta={{ pct: pctChange(kpi.cur.spend, kpi.prev.spend), goodWhen: 'down' }} spark={sparkOf((i) => series[i]!.spend)} sparkColor="var(--chart-2)" hint={`Previous period: ${money(kpi.prev.spend)}`} />
        <KpiCard label="Avg price / litre" icon={Tag} value={kpi.cur.price} format={(n) => money(n, { digits: 2 })} delta={{ pct: pctChange(kpi.cur.price, kpi.prev.price), goodWhen: 'down' }} spark={sparkOf((i) => (series[i]!.litres ? series[i]!.spend / series[i]!.litres : 0))} sparkColor="var(--chart-3)" hint={`Previous period: ${money(kpi.prev.price, { digits: 2 })}`} />
        <KpiCard label="Fleet avg L/100 km" icon={Gauge} value={kpi.cur.eff.l100 ?? 0} format={(n) => n.toFixed(1)} unit="L/100" delta={{ pct: pctChange(kpi.cur.eff.l100 ?? 0, kpi.prev.eff.l100 ?? 0), goodWhen: 'down' }} spark={sparkOf((i) => (series[i]!.rk ? (series[i]!.rl / series[i]!.rk) * 100 : 0))} sparkColor="var(--chart-4)" hint={`Distance-weighted over ${kpi.cur.eff.fills} reliable fill intervals (${fmtNumber(kpi.cur.eff.km)} km)`} />
        <KpiCard label="Cost per km" icon={Route} value={kpi.cur.eff.costPerKm ?? 0} format={(n) => money(n, { digits: 2 })} delta={{ pct: pctChange(kpi.cur.eff.costPerKm ?? 0, kpi.prev.eff.costPerKm ?? 0), goodWhen: 'down' }} spark={sparkOf((i) => (series[i]!.rk ? series[i]!.rs / series[i]!.rk : 0))} sparkColor="var(--chart-5)" hint="Fuel spend ÷ distance on reliable fill intervals" />
        <KpiCard
          label="Flagged transactions"
          icon={Flag}
          value={kpi.cur.flagged}
          status={openCount ? 'danger' : kpi.cur.flagged ? 'warning' : 'success'}
          delta={{ pct: pctChange(kpi.cur.flagged, kpi.prev.flagged), goodWhen: 'down' }}
          spark={sparkOf((i) => series[i]!.flagged)}
          sparkColor="var(--chart-6)"
          hint={`${openCount} open · ${reviewingCount} under review · ${escalatedCount} escalated`}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ChartCard
          title="Consumption & spend"
          description="Litres purchased (bars) and spend (line) per period"
          className="xl:col-span-2"
          actions={
            <Segmented
              aria-label="Granularity"
              value={gran}
              onChange={setGranOverride}
              options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
            />
          }
        >
          <TimeSeriesChart
            data={trend}
            titleKey="title"
            height={270}
            yFormat={(v) => fmtCompact(v)}
            y2Format={(v) => money(v, { compact: true })}
            series={[
              { key: 'litres', label: 'Litres', type: 'bar', color: 'var(--chart-1)', format: (v) => `${fmtNumber(v)} L` },
              { key: 'spend', label: 'Spend', type: 'line', axis: 'right', color: 'var(--chart-2)', format: (v) => money(v) },
            ]}
          />
        </ChartCard>

        <Panel title="Efficiency by vehicle category" description="Actual L/100 km vs category benchmark (tick)">
          {categoryEff.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">Not enough fills with odometer readings in this period.</p>
          ) : (
            <ul className="space-y-3">
              {categoryEff.map((c) => {
                const over = (c.l100 - c.benchmark) / c.benchmark
                return (
                  <li key={c.key}>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span>{c.label} <span className="text-subtle-foreground">· {c.fills} fills</span></span>
                      <span className="num font-medium">
                        {c.l100.toFixed(1)} <span className={cn('text-[11px]', over > 0.1 ? 'text-danger' : over < -0.05 ? 'text-success' : 'text-muted-foreground')}>({over >= 0 ? '+' : ''}{Math.round(over * 100)}%)</span>
                      </span>
                    </div>
                    <div className="relative h-2 rounded-full bg-surface-3">
                      <div className={cn('h-full rounded-full transition-[width] duration-700', over > 0.1 ? 'bg-danger/80' : 'bg-primary')} style={{ width: `${(c.l100 / maxCat) * 100}%` }} />
                      <span className="absolute -top-0.5 h-3 w-0.5 rounded bg-foreground/80" style={{ left: `${(c.benchmark / maxCat) * 100}%` }} title={`Benchmark ${c.benchmark} L/100 km`} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel
          title="Suspicious consumption detection"
          description={`${queue.length} flagged ${queueScope === 'range' ? `in ${range.label.toLowerCase()}` : 'all time'} · ${queue.filter((r) => r.flagState === 'open').length} awaiting action`}
          className="xl:col-span-2"
          flush
          actions={<Segmented aria-label="Queue period" size="xs" value={queueScope} onChange={setQueueScope} options={[{ value: 'range', label: 'In period' }, { value: 'all', label: 'All time' }]} />}
        >
          <div className="flex flex-wrap gap-1.5 border-b border-border px-3.5 py-2.5">
            {RULE_KEYS.map((k) => {
              const Icon = RULE_ICON[k]
              const n = queueRuleCounts.get(k) ?? 0
              const active = ruleFilter === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRuleFilter(active ? null : k)}
                  title={FUEL_RULES[k].summary}
                  aria-pressed={active}
                  className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors', active ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground', !n && 'opacity-60')}
                >
                  <Icon className={cn('size-3.5', RULE_TONE[k])} />
                  {FUEL_RULES[k].short}
                  <span className="num rounded bg-surface-3 px-1 text-[11px] font-medium text-foreground">{n}</span>
                </button>
              )
            })}
          </div>
          {queueShown.length === 0 ? (
            <EmptyState compact icon={Fuel} title="No flagged transactions" description={ruleFilter ? 'No transactions match this rule — clear the filter.' : 'The detection rules found nothing suspicious in this period.'} />
          ) : (
            <ul className="max-h-[34rem] divide-y divide-border overflow-y-auto">
              {queueShown.map((r) => {
                const ex = explainFlag(r)!
                const Icon = RULE_ICON[ex.rule]
                return (
                  <li key={r.id} className="flex gap-3 px-3.5 py-3">
                    <span className={cn('w-1 shrink-0 rounded-full', SEV_BAR[r.flag!.severity])} aria-hidden />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Icon className={cn('size-4', RULE_TONE[ex.rule])} />
                        <span className="text-[13px] font-medium">{ex.title}</span>
                        <FlagBadge flag={r.flag} state={r.flagState} rule={r.rule} compact />
                        <button type="button" onClick={() => navigate(`/fuel/transactions?open=${r.id}`)} className="num text-xs text-primary hover:underline">{r.ref}</button>
                      </div>
                      <p className="text-xs text-muted-foreground">{ex.detail}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
                        <VehicleLink id={r.vehicleId} />
                        <DriverLink id={r.driverId} />
                        <span>{r.stationName}</span>
                        <span>{fmtDateTime(r.date)}</span>
                        <span className="num">{fmtNumber(r.litres, 1)} L · {money(r.totalUsd, { digits: 2 })}</span>
                        <Badge severity={r.flag!.severity} />
                      </div>
                      <FlagActionButtons row={r} flags={flags} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Vehicle efficiency"
          description="vs category benchmark"
          actions={<Segmented aria-label="Ranking" size="xs" value={vehicleView} onChange={setVehicleView} options={[{ value: 'worst', label: 'Least efficient' }, { value: 'best', label: 'Most efficient' }]} />}
        >
          {vehicleRank.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">Needs at least two reliable fill intervals per vehicle in this period.</p>
          ) : (
            <ul className="space-y-3">
              {vehicleRank.map((v, i) => (
                <li key={v.vehicleId}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="num w-4 text-subtle-foreground">{i + 1}</span>
                      <VehicleLink id={v.vehicleId} />
                      <span className="truncate text-subtle-foreground">{VEHICLE_CATEGORY[v.category]}</span>
                    </span>
                    <span className="num shrink-0 font-medium">
                      {v.l100.toFixed(1)} <span className={cn('text-[11px]', v.deltaPct > 10 ? 'text-danger' : v.deltaPct < 0 ? 'text-success' : 'text-muted-foreground')}>{v.deltaPct >= 0 ? '+' : ''}{Math.round(v.deltaPct)}%</span>
                    </span>
                  </div>
                  <DeviationBar value={v.deltaPct} max={50} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCard title={isAll ? 'Cost per km by branch' : 'Cost per km by category'} description="Fuel spend ÷ distance driven">
          <BarList items={costPerKm.map((c, i) => ({ label: c.label, value: c.value, sub: c.sub, color: i === 0 ? 'var(--chart-3)' : 'var(--chart-1)' }))} format={(v) => money(v, { digits: 2 })} emptyText="Not enough odometer data in this period" />
        </ChartCard>

        <ChartCard
          title="Price per litre"
          description="Average price paid vs fleet average"
          actions={<Segmented aria-label="Group by" size="xs" value={priceView} onChange={setPriceView} options={[{ value: 'brand', label: 'Brand' }, { value: 'city', label: 'City' }]} />}
        >
          {priceRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No purchases in this period</p>
          ) : (
            <ul className="space-y-2.5">
              {priceRows.map((p) => (
                <li key={p.label}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span>{p.label} <span className="text-subtle-foreground">· {fmtNumber(p.litres)} L</span></span>
                    <span className="num font-medium">
                      {money(p.price, { digits: 2 })} <span className={cn('text-[11px]', p.delta > 0.005 ? 'text-danger' : p.delta < -0.005 ? 'text-success' : 'text-muted-foreground')}>{p.delta >= 0 ? '+' : '−'}{Math.abs(p.delta * 100).toFixed(1)}¢</span>
                    </span>
                  </div>
                  <DeviationBar value={p.pct} max={5} />
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard title="Spend by station" description="Top 8 stations">
          <BarList
            items={stationSpend.map((s) => ({ label: s.name, sub: `${s.city} · ${fmtNumber(s.litres)} L`, value: s.value, color: 'var(--chart-2)', onClick: () => navigate(`/fuel/stations?open=${s.id}`) }))}
            format={(v) => money(v)}
            emptyText="No purchases in this period"
          />
        </ChartCard>
      </div>
    </Page>
  )
}

function Badge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  return <span className={cn('rounded px-1 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_TONE[severity] === 'danger' ? 'bg-danger/12 text-danger' : SEVERITY_TONE[severity] === 'warning' ? 'bg-warning/12 text-warning' : 'bg-info/12 text-info')}>{severity}</span>
}

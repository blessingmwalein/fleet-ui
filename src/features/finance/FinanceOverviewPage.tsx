import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Download, X } from 'lucide-react'
import type { Expense } from '@/types'
import { useDb } from '@/store/db'
import { useById } from '@/hooks/useLookup'
import { useCan } from '@/hooks/useAuth'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { autoGranularity, makeBuckets, type Granularity } from '@/lib/analytics'
import { downloadObjectsCsv } from '@/lib/csv'
import { VEHICLE_CATEGORY } from '@/config/status'
import { fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { BarList, ChartCard, DonutChart, TimeSeriesChart } from '@/components/charts/charts'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { RejectExpenseDialog, useExpenseActions } from './expenseActions'
import { AgeingBars } from './profitCharts'
import { useCosts, useInvoices, useRevenue } from './hooks'
import { COST_CATEGORIES, COST_COLOR, COST_LABEL, ageingBuckets, emptyCats, invoiceBalance, rangeBudget, totals, trendRows, vehiclePnl, daysPastDue } from './lib'

const AGEING_COLORS = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-3)', 'var(--chart-6)', 'var(--chart-6)']

export default function FinanceOverviewPage() {
  const money = useMoney()
  const range = useDateRange()
  const { branchId } = useBranchScope()
  const canApprove = useCan('finance.approve')
  const canExport = useCan('finance.export')
  const { scoped: revAll } = useRevenue()
  const { scoped: costAll, lookup } = useCosts()
  const { scoped: invoices } = useInvoices()
  const budgets = useDb((s) => s.budgets)
  const expenses = useDb((s) => s.expenses)
  const { scope } = useBranchScope()
  const getVehicle = useById('vehicles')
  const actions = useExpenseActions()
  const [rejecting, setRejecting] = useState<Expense[] | null>(null)
  const [gran, setGran] = useState<Granularity>(() => (range.days > 14 && range.days <= 60 ? 'week' : autoGranularity(range.days)))

  const rev = useMemo(() => revAll.filter((r) => range.inRange(r.ts)), [revAll, range])
  const revPrev = useMemo(() => revAll.filter((r) => range.inPrevRange(r.ts)), [revAll, range])
  const costs = useMemo(() => costAll.filter((c) => range.inRange(c.ts)), [costAll, range])
  const costsPrev = useMemo(() => costAll.filter((c) => range.inPrevRange(c.ts)), [costAll, range])
  const tot = useMemo(() => totals(rev, costs), [rev, costs])
  const prev = useMemo(() => totals(revPrev, costsPrev), [revPrev, costsPrev])

  const trend = useMemo(() => trendRows(rev, costs, makeBuckets(range.from, range.to, gran)), [rev, costs, range, gran])

  const ar = useMemo(() => invoices.filter((i) => i.kind === 'customer'), [invoices])
  const ap = useMemo(() => invoices.filter((i) => i.kind === 'supplier'), [invoices])
  const now = Date.now()
  const arOutstanding = ar.filter((i) => i.status !== 'draft').reduce((s, i) => s + invoiceBalance(i), 0)
  const arOverdue = ar.filter((i) => daysPastDue(i, now) > 0).reduce((s, i) => s + invoiceBalance(i), 0)
  const apOutstanding = ap.filter((i) => i.status !== 'draft').reduce((s, i) => s + invoiceBalance(i), 0)
  const apOverdue = ap.filter((i) => daysPastDue(i, now) > 0).reduce((s, i) => s + invoiceBalance(i), 0)
  const apSoon = ap.filter((i) => i.status !== 'draft' && daysPastDue(i, now) === 0 && invoiceBalance(i) > 0 && new Date(i.dueDate).getTime() - now < 14 * 864e5).reduce((s, i) => s + invoiceBalance(i), 0)
  const ageing = useMemo(() => ageingBuckets(ar, now), [ar]) // eslint-disable-line react-hooks/exhaustive-deps

  const bud = useMemo(() => rangeBudget(budgets, lookup, costAll, branchId, range.from, range.to), [budgets, lookup, costAll, branchId, range])
  const pending = useMemo(() => scope(expenses).filter((e) => e.status === 'pending').sort((a, b) => a.date.localeCompare(b.date)), [expenses, scope])
  const pendingTotal = pending.reduce((s, e) => s + e.amountUsd, 0)

  const vehicles = useMemo(() => vehiclePnl(getVehicle, rev, costs, false), [getVehicle, rev, costs])
  const topVehicles = useMemo(() => [...vehicles.rows].sort((a, b) => b.cost - a.cost).slice(0, 6), [vehicles])
  const byClass = useMemo(() => {
    const m = new Map<string, { n: number; cats: ReturnType<typeof emptyCats> }>()
    for (const v of vehicles.rows) {
      if (v.cost <= 0) continue
      const g = m.get(v.vehicleCategory) ?? { n: 0, cats: emptyCats() }
      g.n += 1
      for (const c of COST_CATEGORIES) g.cats[c] += v.byCategory[c]
      m.set(v.vehicleCategory, g)
    }
    return [...m.entries()].map(([k, g]) => ({ label: VEHICLE_CATEGORY[k as keyof typeof VEHICLE_CATEGORY], n: g.n, ...Object.fromEntries(COST_CATEGORIES.map((c) => [c, Math.round(g.cats[c] / g.n)])) }))
  }, [vehicles])

  const donut = COST_CATEGORIES.map((c) => ({ name: COST_LABEL[c], value: Math.round(tot.byCategory[c]), color: COST_COLOR[c] })).filter((d) => d.value > 0)

  const exportCsv = () =>
    downloadObjectsCsv(`finance-overview-${new Date().toISOString().slice(0, 10)}`, [{ k: 'Revenue', v: tot.revenue }, ...COST_CATEGORIES.map((c) => ({ k: `Cost – ${COST_LABEL[c]}`, v: tot.byCategory[c] })), { k: 'Operating cost', v: tot.cost }, { k: 'Gross margin', v: tot.margin }, { k: 'Receivables outstanding', v: arOutstanding }, { k: 'Payables outstanding', v: apOutstanding }], {
      [`Metric (${range.label})`]: (r) => r.k, 'Amount (USD)': (r) => Math.round(r.v * 100) / 100,
    })

  const marginNum = tot.marginPct ?? 0

  return (
    <Page>
      <PageHeader
        title="Finance overview"
        description={`Revenue, operating cost and cash position for ${range.label.toLowerCase()}. Revenue is recognised on delivery; cost includes fuel, workshop spend and approved expenses.`}
        actions={canExport && <Button variant="outline" onClick={exportCsv}><Download /> Export summary</Button>}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-8">
        <KpiCard label="Revenue" value={tot.revenue} format={(n) => money(n, { compact: true })} delta={{ pct: pctChange(tot.revenue, prev.revenue) }} spark={trend.map((t) => t.revenue)} hint={`${fmtNumber(tot.trips)} delivered trips`} />
        <KpiCard label="Operating cost" value={tot.cost} format={(n) => money(n, { compact: true })} delta={{ pct: pctChange(tot.cost, prev.cost), goodWhen: 'down' }} spark={trend.map((t) => t.cost)} sparkColor="var(--chart-3)" />
        <KpiCard label="Gross margin" value={marginNum} format={(n) => `${n.toFixed(1)}%`} delta={{ pct: pctChange(tot.margin, prev.margin), label: 'margin $ vs prev.' }} status={tot.marginPct !== null && tot.marginPct < 0 ? 'danger' : undefined} spark={trend.map((t) => t.margin)} sparkColor="var(--chart-2)" hint={`${money(tot.margin)} margin`} />
        <KpiCard label="Cost per km" value={tot.costPerKm ?? 0} format={(n) => money(n, { digits: 2 })} delta={{ pct: pctChange(tot.costPerKm ?? 0, prev.costPerKm ?? 0), goodWhen: 'down' }} hint={`${fmtNumber(tot.km)} km driven`} />
        <KpiCard label="Receivables" value={arOutstanding} format={(n) => money(n, { compact: true })} href="/finance/invoices" status={arOverdue > 0 ? 'warning' : undefined} hint={`${money(arOverdue)} overdue`} delta={arOutstanding ? { pct: (arOverdue / arOutstanding) * 100, goodWhen: 'down', label: 'overdue share' } : undefined} />
        <KpiCard label="Payables due" value={apOutstanding} format={(n) => money(n, { compact: true })} href="/finance/invoices?tab=supplier" status={apOverdue > 0 ? 'danger' : undefined} hint={`${money(apOverdue)} overdue · ${money(apSoon)} due in 14 days`} />
        <KpiCard label="Budget variance" value={bud.budget ? `${bud.variance > 0 ? '+' : '−'}${money(Math.abs(bud.variance), { compact: true })}` : '—'} href="/finance/budgets" delta={bud.variancePct !== null ? { pct: bud.variancePct, goodWhen: 'down', label: 'vs pro-rata budget' } : undefined} status={bud.variancePct !== null && bud.variancePct > 5 ? 'danger' : undefined} hint="Actual vs budget pro-rated to the selected range" />
        <KpiCard label="Pending approvals" value={pending.length} format={(n) => String(Math.round(n))} href="/finance/expenses" status={pending.length ? 'warning' : 'success'} hint={`${money(pendingTotal)} awaiting approval`} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Revenue vs operating cost"
          description="With the gross margin trend line"
          actions={<Segmented size="xs" aria-label="Granularity" value={gran} onChange={setGran} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />}
        >
          <TimeSeriesChart
            data={trend}
            titleKey="title"
            height={270}
            yFormat={(v) => money(v, { compact: true })}
            series={[
              { key: 'revenue', label: 'Revenue', type: 'area', color: 'var(--chart-1)', format: (v) => money(v) },
              { key: 'cost', label: 'Operating cost', type: 'bar', color: 'var(--chart-3)', format: (v) => money(v) },
              { key: 'margin', label: 'Gross margin', type: 'line', color: 'var(--chart-2)', format: (v) => money(v) },
            ]}
          />
        </ChartCard>
        <ChartCard title="Operating cost breakdown" description="Fuel, maintenance, tolls, allowances, insurance, tyres and other">
          {donut.length ? <DonutChart data={donut} height={170} format={(v) => money(v, { compact: true })} centerLabel="Operating cost" centerValue={money(tot.cost, { compact: true })} /> : <EmptyState compact title="No cost recorded" />}
        </ChartCard>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Vehicle operating cost by category" description="Average cost per vehicle in each class">
          <TimeSeriesChart
            data={byClass}
            stacked
            height={250}
            yFormat={(v) => money(v, { compact: true })}
            series={COST_CATEGORIES.map((c) => ({ key: c, label: COST_LABEL[c], type: 'bar' as const, color: COST_COLOR[c], format: (v: number) => money(v) }))}
            empty="No vehicle costs in this period"
          />
        </ChartCard>
        <ChartCard title="Receivables ageing" description={`${money(arOutstanding)} outstanding`} actions={<Button size="xs" variant="ghost" asChild><Link to="/finance/invoices">Invoices <ArrowRight /></Link></Button>}>
          <AgeingBars data={ageing.map((b, i) => ({ label: b.label, amount: Math.round(b.amount), count: b.count, color: AGEING_COLORS[i]! }))} money={money} height={250} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel
          title={`Pending approvals${pending.length ? ` (${pending.length})` : ''}`}
          description={pending.length ? `${money(pendingTotal)} awaiting a decision` : 'Nothing waiting'}
          flush
          actions={<Button size="xs" variant="ghost" asChild><Link to="/finance/expenses">Review all <ArrowRight /></Link></Button>}
        >
          {pending.length === 0 ? (
            <EmptyState compact title="All caught up" description="No expense claims are waiting for approval." />
          ) : (
            <ul className="divide-y divide-border">
              {pending.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-3.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px]"><EntityLink type="expense" id={e.id} className="font-mono text-xs font-medium" /><span className="num ml-auto font-semibold">{money(e.amountUsd, { digits: 2 })}</span></div>
                    <p className="truncate text-xs text-muted-foreground">{e.description}</p>
                  </div>
                  {canApprove && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon-sm" variant="outline" aria-label={`Reject ${e.ref}`} onClick={() => setRejecting([e])}><X /></Button>
                      <Button size="icon-sm" aria-label={`Approve ${e.ref}`} onClick={() => void actions.approve([e])}><Check /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most expensive vehicles" description={`Total operating cost · ${range.label}`}>
          <BarList
            items={topVehicles.map((v) => ({ label: <VehicleLink id={v.vehicleId} />, sub: v.costPerKm === null ? undefined : `${money(v.costPerKm, { digits: 2 })}/km`, value: v.cost, color: v.margin < 0 ? 'var(--chart-6)' : 'var(--chart-3)' }))}
            format={(v) => money(v)}
            emptyText="No vehicle costs in this period"
          />
        </Panel>

        <Panel title="Budget vs actual" description={bud.budget ? 'Pro-rated to the selected range' : 'No budgets cover this range'} actions={<Button size="xs" variant="ghost" asChild><Link to="/finance/budgets">Budgets <ArrowRight /></Link></Button>}>
          {bud.budget === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Set budgets on the Budgets page to compare spend.</p>
          ) : (
            <ul className="space-y-3">
              {bud.rows.filter((r) => r.budget > 0 || r.actual > 0).map((r) => {
                const used = r.budget ? (r.actual / r.budget) * 100 : 100
                return (
                  <li key={r.category} className="text-xs">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5"><span className="size-2 rounded-[3px]" style={{ background: COST_COLOR[r.category] }} />{COST_LABEL[r.category]}</span>
                      <span className="num text-muted-foreground"><span className={cn('font-medium', used > 100 ? 'text-danger' : 'text-foreground')}>{money(r.actual, { compact: true })}</span> / {money(r.budget, { compact: true })}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full transition-[width] duration-700', used > 100 ? 'bg-danger' : used > 90 ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.min(100, used)}%` }} /></div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
      <RejectExpenseDialog rows={rejecting} onClose={() => setRejecting(null)} />
    </Page>
  )
}

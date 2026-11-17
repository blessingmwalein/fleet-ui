import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDb } from '@/store/db'
import { useById } from '@/hooks/useLookup'
import { useCan } from '@/hooks/useAuth'
import { useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { VEHICLE_CATEGORY } from '@/config/status'
import { autoGranularity, makeBuckets, sumByBucket } from '@/lib/analytics'
import { fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/form-controls'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable } from '@/components/data-table/DataTable'
import { ChartCard, TimeSeriesChart } from '@/components/charts/charts'
import { KpiCard } from '@/components/shared/KpiCard'
import { BranchLink, CustomerLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { CategoryBadge } from '@/components/shared/Status'
import { MarginBars, PnlScatter } from './profitCharts'
import { useCosts, useInvoices, useRevenue } from './hooks'
import { COST_CATEGORIES, COST_COLOR, COST_LABEL, emptyCats, groupTrips, invoiceBalance, totals, tripEconomics, vehicleToGroup, vehiclePnl, type GroupPnl, type VehiclePnl } from './lib'
import { MarginPct } from './ui'

type View = 'vehicles' | 'customers' | 'routes'

export default function ProfitabilityPage() {
  const money = useMoney()
  const range = useDateRange()
  const canExport = useCan('finance.export')
  const getVehicle = useById('vehicles')
  const getCustomer = useById('customers')
  const branches = useDb((s) => s.branches)
  const { scoped: allRev } = useRevenue()
  const { scoped: allCosts } = useCosts()
  const { scoped: invoices } = useInvoices()
  const [view, setView] = useState<View>('vehicles')
  const [allocate, setAllocate] = useState(false)
  const [chartMode, setChartMode] = useState<'bars' | 'scatter'>('bars')
  const [cpkMode, setCpkMode] = useState<'class' | 'time'>('class')
  const [selected, setSelected] = useState<string | null>(null)

  const rev = useMemo(() => allRev.filter((r) => range.inRange(r.ts)), [allRev, range])
  const costs = useMemo(() => allCosts.filter((c) => range.inRange(c.ts)), [allCosts, range])
  const tot = useMemo(() => totals(rev, costs), [rev, costs])
  const vehicles = useMemo(() => vehiclePnl(getVehicle, rev, costs, allocate), [getVehicle, rev, costs, allocate])
  const econ = useMemo(() => tripEconomics(rev, costs), [rev, costs])
  const customerGroups = useMemo(() => groupTrips(econ.trips, (t) => t.customerId ?? 'none', (k) => getCustomer(k)?.name ?? 'Unassigned'), [econ, getCustomer])
  const routeGroups = useMemo(() => groupTrips(econ.trips, (t) => `${t.origin} → ${t.destination}`, (k) => k), [econ])
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const arByCustomer = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of invoices) if (i.kind === 'customer' && i.partyId && i.status !== 'draft') m.set(i.partyId, (m.get(i.partyId) ?? 0) + invoiceBalance(i))
    return m
  }, [invoices])

  const groups = useMemo<GroupPnl[]>(() => (view === 'vehicles' ? vehicles.rows.map(vehicleToGroup) : view === 'customers' ? customerGroups : routeGroups), [view, vehicles, customerGroups, routeGroups])
  const ranked = useMemo(() => [...groups].sort((a, b) => b.margin - a.margin), [groups])
  const top5 = ranked.slice(0, 5)
  const bottom5 = ranked.length > 5 ? ranked.slice(-5).reverse() : []
  const barData = useMemo(() => (ranked.length <= 14 ? ranked : [...ranked.slice(0, 7), ...ranked.slice(-7)]), [ranked])
  const losing = vehicles.rows.filter((v) => v.margin < 0).length
  const noun = view === 'vehicles' ? 'vehicle' : view === 'customers' ? 'customer' : 'route'
  const unalloc = view === 'vehicles' ? (allocate ? 0 : vehicles.overheadPool) : econ.unallocated

  // cost per km analysis
  const cpkClass = useMemo(() => {
    const byClass = new Map<string, { km: number; cats: ReturnType<typeof emptyCats> }>()
    for (const v of vehicles.rows) {
      const g = byClass.get(v.vehicleCategory) ?? { km: 0, cats: emptyCats() }
      g.km += v.km
      for (const c of COST_CATEGORIES) g.cats[c] += v.byCategory[c]
      byClass.set(v.vehicleCategory, g)
    }
    return [...byClass.entries()].filter(([, g]) => g.km > 0).map(([k, g]) => ({ label: VEHICLE_CATEGORY[k as keyof typeof VEHICLE_CATEGORY], ...Object.fromEntries(COST_CATEGORIES.map((c) => [c, Math.round((g.cats[c] / g.km) * 1000) / 1000])) }))
  }, [vehicles])
  const cpkTime = useMemo(() => {
    const buckets = makeBuckets(range.from, range.to, autoGranularity(range.days))
    const km = sumByBucket(rev, buckets, (r) => r.ts, (r) => r.km)
    const rv = sumByBucket(rev, buckets, (r) => r.ts, (r) => r.revenueUsd)
    const cs = sumByBucket(costs, buckets, (c) => c.ts, (c) => c.amountUsd)
    return buckets.map((b, i) => ({ label: b.label, title: b.title, revenuePerKm: km[i]! > 0 ? Math.round((rv[i]! / km[i]!) * 100) / 100 : null, costPerKm: km[i]! > 0 ? Math.round((cs[i]! / km[i]!) * 100) / 100 : null }))
  }, [rev, costs, range])

  const selectedVehicle = selected ? vehicles.rows.find((v) => v.vehicleId === selected) ?? null : null

  const exportName = canExport ? `${view}-profitability` : undefined
  const vehicleColumns = useMemo<ColumnDef<VehiclePnl, any>[]>(
    () => [
      { id: 'reg', accessorFn: (r) => r.reg, header: 'Vehicle', size: 108, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'class', accessorFn: (r) => VEHICLE_CATEGORY[r.vehicleCategory], header: 'Class', size: 126, cell: ({ row }) => <CategoryBadge category={row.original.vehicleCategory} /> },
      { id: 'branch', accessorFn: (r) => branchName.get(r.branchId) ?? '', header: 'Branch', size: 170, cell: ({ row }) => <BranchLink id={row.original.branchId} /> },
      { id: 'trips', accessorFn: (r) => r.trips, header: 'Trips', size: 62, meta: { align: 'right' } },
      { id: 'km', accessorFn: (r) => Math.round(r.km), header: 'Distance', size: 86, meta: { align: 'right', label: 'Distance (km)' }, cell: ({ row }) => `${fmtNumber(row.original.km)} km` },
      { id: 'revenue', accessorFn: (r) => Math.round(r.revenue), header: 'Revenue', size: 100, meta: { align: 'right', label: 'Revenue (USD)' }, cell: ({ row }) => money(row.original.revenue) },
      { id: 'fuel', accessorFn: (r) => Math.round(r.fuel), header: 'Fuel', size: 90, meta: { align: 'right', label: 'Fuel (USD)' }, cell: ({ row }) => <span className="text-muted-foreground">{money(row.original.fuel)}</span> },
      { id: 'maint', accessorFn: (r) => Math.round(r.maintenance), header: 'Maintenance', size: 108, meta: { align: 'right', label: 'Maintenance (USD)' }, cell: ({ row }) => <span className="text-muted-foreground">{money(row.original.maintenance)}</span> },
      { id: 'other', accessorFn: (r) => Math.round(r.other), header: 'Other costs', size: 100, meta: { align: 'right', label: 'Other costs (USD)' }, cell: ({ row }) => <span className="text-muted-foreground">{money(row.original.other)}</span> },
      { id: 'cost', accessorFn: (r) => Math.round(r.cost), header: 'Total cost', size: 100, meta: { align: 'right', label: 'Total cost (USD)' }, cell: ({ row }) => money(row.original.cost) },
      { id: 'margin', accessorFn: (r) => Math.round(r.margin), header: 'Margin', size: 100, meta: { align: 'right', label: 'Margin (USD)' }, cell: ({ row }) => <span className={cn('font-semibold', row.original.margin < 0 ? 'text-danger' : 'text-success')}>{money(row.original.margin)}</span> },
      { id: 'marginPct', accessorFn: (r) => (r.marginPct === null ? null : Math.round(r.marginPct * 10) / 10), header: 'Margin %', size: 84, meta: { align: 'right' }, cell: ({ row }) => <MarginPct value={row.original.marginPct} /> },
      { id: 'revKm', accessorFn: (r) => (r.revenuePerKm === null ? null : Math.round(r.revenuePerKm * 100) / 100), header: 'Rev / km', size: 86, meta: { align: 'right' }, cell: ({ row }) => (row.original.revenuePerKm === null ? '—' : money(row.original.revenuePerKm, { digits: 2 })) },
      { id: 'costKm', accessorFn: (r) => (r.costPerKm === null ? null : Math.round(r.costPerKm * 100) / 100), header: 'Cost / km', size: 90, meta: { align: 'right' }, cell: ({ row }) => (row.original.costPerKm === null ? '—' : money(row.original.costPerKm, { digits: 2 })) },
    ],
    [money, branchName],
  )
  const groupColumns = useMemo<ColumnDef<GroupPnl, any>[]>(
    () => [
      { id: 'label', accessorFn: (r) => r.label, header: view === 'customers' ? 'Customer' : 'Route', size: 230, cell: ({ row }) => (view === 'customers' && row.original.key !== 'none' ? <CustomerLink id={row.original.key} /> : <span>{row.original.label}</span>) },
      { id: 'trips', accessorFn: (r) => r.trips, header: 'Trips', size: 62, meta: { align: 'right' } },
      { id: 'km', accessorFn: (r) => Math.round(r.km), header: 'Distance', size: 90, meta: { align: 'right', label: 'Distance (km)' }, cell: ({ row }) => `${fmtNumber(row.original.km)} km` },
      { id: 'revenue', accessorFn: (r) => Math.round(r.revenue), header: 'Revenue', size: 104, meta: { align: 'right', label: 'Revenue (USD)' }, cell: ({ row }) => money(row.original.revenue) },
      { id: 'cost', accessorFn: (r) => Math.round(r.cost), header: 'Cost', size: 100, meta: { align: 'right', label: 'Cost (USD)' }, cell: ({ row }) => money(row.original.cost) },
      { id: 'margin', accessorFn: (r) => Math.round(r.margin), header: 'Margin', size: 100, meta: { align: 'right', label: 'Margin (USD)' }, cell: ({ row }) => <span className={cn('font-semibold', row.original.margin < 0 ? 'text-danger' : 'text-success')}>{money(row.original.margin)}</span> },
      { id: 'marginPct', accessorFn: (r) => (r.marginPct === null ? null : Math.round(r.marginPct * 10) / 10), header: 'Margin %', size: 84, meta: { align: 'right' }, cell: ({ row }) => <MarginPct value={row.original.marginPct} /> },
      { id: 'revKm', accessorFn: (r) => (r.revenuePerKm === null ? null : Math.round(r.revenuePerKm * 100) / 100), header: 'Rev / km', size: 86, meta: { align: 'right' }, cell: ({ row }) => (row.original.revenuePerKm === null ? '—' : money(row.original.revenuePerKm, { digits: 2 })) },
      { id: 'costKm', accessorFn: (r) => (r.costPerKm === null ? null : Math.round(r.costPerKm * 100) / 100), header: 'Cost / km', size: 90, meta: { align: 'right' }, cell: ({ row }) => (row.original.costPerKm === null ? '—' : money(row.original.costPerKm, { digits: 2 })) },
      ...(view === 'customers' ? [{ id: 'ar', accessorFn: (r: GroupPnl) => Math.round(arByCustomer.get(r.key) ?? 0), header: 'Receivable', size: 104, meta: { align: 'right' as const, label: 'Outstanding (USD)' }, cell: ({ row }: { row: { original: GroupPnl } }) => <span className="text-muted-foreground">{money(arByCustomer.get(row.original.key) ?? 0)}</span> } as ColumnDef<GroupPnl, any>] : []),
    ],
    [money, view, arByCustomer],
  )

  const facets = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort().map((v) => ({ value: v, label: v }))
    return [
      { columnId: 'class', label: 'Vehicle class', options: uniq(vehicles.rows.map((r) => VEHICLE_CATEGORY[r.vehicleCategory])) },
      { columnId: 'branch', label: 'Branch', options: uniq(vehicles.rows.map((r) => branchName.get(r.branchId) ?? '')) },
    ]
  }, [vehicles, branchName])

  const callout = (title: string, icon: React.ReactNode, list: GroupPnl[]) => (
    <Panel title={title} description={`By margin · ${range.label}`} actions={icon} flush>
      {list.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Not enough {noun}s to rank</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((g, i) => (
            <li key={g.key}>
              <button type="button" disabled={view !== 'vehicles'} onClick={() => view === 'vehicles' && setSelected(g.key)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] transition-colors enabled:hover:bg-accent/40 disabled:cursor-default">
                <span className="num w-4 text-xs text-subtle-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{g.label}<span className="ml-2 text-xs font-normal text-subtle-foreground">{g.trips} trips · {money(g.revenue, { compact: true })} rev</span></span>
                <MarginPct value={g.marginPct} className="text-xs" />
                <span className={cn('num w-20 text-right font-semibold', g.margin < 0 ? 'text-danger' : 'text-success')}>{money(g.margin)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )

  return (
    <Page>
      <PageHeader
        title="Profitability"
        description={`Margin analysis for ${range.label.toLowerCase()}: revenue from delivered trips less fuel, maintenance and approved expenses.`}
        actions={<Segmented aria-label="Analysis view" size="md" value={view} onChange={setView} options={[{ value: 'vehicles', label: 'Vehicles' }, { value: 'customers', label: 'Customers' }, { value: 'routes', label: 'Routes' }]} />}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-8">
        <KpiCard label="Revenue" value={tot.revenue} format={(n) => money(n, { compact: true })} hint={`${fmtNumber(tot.trips)} delivered trips`} />
        <KpiCard label="Operating cost" value={tot.cost} format={(n) => money(n, { compact: true })} />
        <KpiCard label="Gross margin" value={tot.margin} format={(n) => money(n, { compact: true })} status={tot.margin < 0 ? 'danger' : undefined} />
        <KpiCard label="Margin %" value={tot.marginPct === null ? '—' : `${tot.marginPct.toFixed(1)}%`} status={tot.marginPct !== null && tot.marginPct < 0 ? 'danger' : undefined} />
        <KpiCard label="Revenue / km" value={tot.revenuePerKm === null ? '—' : money(tot.revenuePerKm, { digits: 2 })} hint={`${fmtNumber(tot.km)} km driven`} />
        <KpiCard label="Cost / km" value={tot.costPerKm === null ? '—' : money(tot.costPerKm, { digits: 2 })} />
        <KpiCard label="Loss-making vehicles" value={`${losing} / ${vehicles.rows.length}`} status={losing ? 'warning' : 'success'} />
        <KpiCard label="Unallocated overhead" value={money(unalloc, { compact: true })} hint={view === 'vehicles' ? 'Fleet-level costs (e.g. insurance premiums) not tied to a vehicle' : 'Costs of vehicles without delivered trips and fleet overheads'} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard
          title={chartMode === 'bars' ? `Margin by ${noun}` : `Revenue vs cost by ${noun}`}
          description={chartMode === 'bars' ? (ranked.length > 14 ? 'Best 7 and worst 7' : 'All, best to worst') : 'Above the diagonal = profitable'}
          actions={<Segmented size="xs" aria-label="Chart type" value={chartMode} onChange={setChartMode} options={[{ value: 'bars', label: 'Bars' }, { value: 'scatter', label: 'Scatter' }]} />}
        >
          {chartMode === 'bars' ? <MarginBars data={barData} money={money} height={Math.max(260, barData.length * 24 + 28)} onSelect={(g) => view === 'vehicles' && setSelected(g.key)} /> : <PnlScatter data={groups} money={money} height={Math.max(260, Math.min(420, barData.length * 24 + 28))} onSelect={(g) => view === 'vehicles' && setSelected(g.key)} />}
        </ChartCard>
        <ChartCard
          title="Cost per kilometre"
          description={cpkMode === 'class' ? 'By vehicle class and cost category' : 'Revenue vs cost per km over time'}
          actions={<Segmented size="xs" aria-label="Cost per km view" value={cpkMode} onChange={setCpkMode} options={[{ value: 'class', label: 'By class' }, { value: 'time', label: 'Over time' }]} />}
        >
          {cpkMode === 'class' ? (
            <TimeSeriesChart
              data={cpkClass}
              stacked
              height={Math.max(260, Math.min(420, barData.length * 24 + 28))}
              yFormat={(v) => money(v, { digits: 2 })}
              series={COST_CATEGORIES.map((c) => ({ key: c, label: COST_LABEL[c], type: 'bar' as const, color: COST_COLOR[c], format: (v: number) => money(v, { digits: 2 }) }))}
              empty="No distance driven in this period"
            />
          ) : (
            <TimeSeriesChart
              data={cpkTime}
              titleKey="title"
              height={Math.max(260, Math.min(420, barData.length * 24 + 28))}
              yFormat={(v) => money(v, { digits: 2 })}
              series={[
                { key: 'revenuePerKm', label: 'Revenue / km', type: 'line', color: 'var(--chart-1)', format: (v) => money(v, { digits: 2 }) },
                { key: 'costPerKm', label: 'Cost / km', type: 'line', color: 'var(--chart-6)', format: (v) => money(v, { digits: 2 }) },
              ]}
            />
          )}
        </ChartCard>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {callout(`Top 5 ${noun}s`, <TrendingUp className="size-4 text-success" />, top5)}
        {callout(`Bottom 5 ${noun}s`, <TrendingDown className="size-4 text-danger" />, bottom5)}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{view === 'vehicles' ? 'Vehicle P&L' : view === 'customers' ? 'Customer profitability' : 'Route profitability'}</h2>
        {view === 'vehicles' && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={allocate} onCheckedChange={setAllocate} aria-label="Allocate fleet overheads" />
            Allocate fleet overheads equally ({money(vehicles.overheadPool, { compact: true })})
          </label>
        )}
        {view !== 'vehicles' && <p className="text-xs text-subtle-foreground">Costs = trip-linked fuel & claims + km-weighted share of each vehicle&apos;s other costs.</p>}
      </div>

      {view === 'vehicles' ? (
        <DataTable<VehiclePnl>
          tableId="finance.profit.vehicles"
          data={vehicles.rows}
          columns={vehicleColumns}
          getRowId={(r) => r.vehicleId}
          exportName={exportName}
          facets={facets}
          searchPlaceholder="Search vehicle…"
          defaultSort={[{ id: 'margin', desc: true }]}
          defaultHidden={['branch', 'other']}
          onRowClick={(r) => setSelected(r.vehicleId)}
          emptyTitle="No vehicle activity in this period"
          mobileCard={(r) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between"><VehicleLink id={r.vehicleId} /><MarginPct value={r.marginPct} /></div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>{r.trips} trips · {fmtNumber(r.km)} km</span><span className="num">Rev {money(r.revenue, { compact: true })} · Cost {money(r.cost, { compact: true })}</span></div>
              <div className={cn('num text-sm font-semibold', r.margin < 0 ? 'text-danger' : 'text-success')}>{money(r.margin)}</div>
            </div>
          )}
        />
      ) : (
        <DataTable<GroupPnl>
          key={view}
          tableId={`finance.profit.${view}`}
          data={groups}
          columns={groupColumns}
          getRowId={(r) => r.key}
          exportName={exportName}
          searchPlaceholder={view === 'customers' ? 'Search customer…' : 'Search route…'}
          defaultSort={[{ id: 'margin', desc: true }]}
          emptyTitle="No delivered trips in this period"
          mobileCard={(r) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.label}</span><MarginPct value={r.marginPct} /></div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>{r.trips} trips</span><span className="num">Rev {money(r.revenue, { compact: true })} · Cost {money(r.cost, { compact: true })}</span></div>
              <div className={cn('num text-sm font-semibold', r.margin < 0 ? 'text-danger' : 'text-success')}>{money(r.margin)}</div>
            </div>
          )}
        />
      )}

      <VehiclePnlDrawer v={selectedVehicle} rev={rev} onClose={() => setSelected(null)} />
    </Page>
  )
}

function VehiclePnlDrawer({ v, rev, onClose }: { v: VehiclePnl | null; rev: ReturnType<typeof useRevenue>['scoped']; onClose: () => void }) {
  const money = useMoney()
  const [last, setLast] = useState<VehiclePnl | null>(null)
  if (v && v !== last) setLast(v)
  const x = v ?? last
  const trips = useMemo(() => (x ? rev.filter((r) => r.vehicleId === x.vehicleId).sort((a, b) => b.ts - a.ts).slice(0, 8) : []), [rev, x])
  const maxCat = x ? Math.max(...COST_CATEGORIES.map((c) => x.byCategory[c]), 1) : 1
  return (
    <Sheet open={!!v} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        {x && (
          <>
            <SheetHeader>
              <SheetTitle><VehicleLink id={x.vehicleId} /></SheetTitle>
              <SheetDescription>{x.make} {x.model} · {VEHICLE_CATEGORY[x.vehicleCategory]}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="panel p-2.5"><div className="label-xs">Revenue</div><div className="num text-base font-semibold">{money(x.revenue)}</div></div>
                <div className="panel p-2.5"><div className="label-xs">Cost</div><div className="num text-base font-semibold">{money(x.cost)}</div></div>
                <div className="panel p-2.5"><div className="label-xs">Margin</div><div className={cn('num text-base font-semibold', x.margin < 0 ? 'text-danger' : 'text-success')}>{money(x.margin)}</div><MarginPct value={x.marginPct} className="text-[11px]" /></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                <div>{x.trips} trips</div><div>{fmtNumber(x.km)} km</div><div>{x.costPerKm === null ? '—' : `${money(x.costPerKm, { digits: 2 })}/km cost`}</div>
              </div>
              <div>
                <h3 className="label-xs mb-2">Cost breakdown</h3>
                <ul className="space-y-2">
                  {COST_CATEGORIES.map((c) => (
                    <li key={c} className="text-xs">
                      <div className="mb-1 flex justify-between"><span className="text-muted-foreground">{COST_LABEL[c]}</span><span className="num font-medium">{money(x.byCategory[c])}</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${Math.max(x.byCategory[c] ? 2 : 0, (x.byCategory[c] / maxCat) * 100)}%`, background: COST_COLOR[c] }} /></div>
                    </li>
                  ))}
                </ul>
                {x.overhead > 0 && <p className="mt-2 text-[11px] text-subtle-foreground">Includes {money(x.overhead)} of allocated fleet overhead.</p>}
              </div>
              <Panel title="Recent delivered trips" flush>
                <ul className="divide-y divide-border">
                  {trips.length === 0 && <li className="py-6 text-center text-xs text-muted-foreground">No delivered trips in this period</li>}
                  {trips.map((t) => (
                    <li key={t.tripId} className="flex items-center justify-between gap-2 px-3.5 py-1.5 text-[13px]">
                      <span className="min-w-0 truncate"><TripLink id={t.tripId} /> <span className="text-xs text-subtle-foreground">{t.origin} → {t.destination}</span></span>
                      <span className="num font-medium">{money(t.revenueUsd)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" asChild><Link to={`/vehicles/${x.vehicleId}`}>Open vehicle <ArrowUpRight /></Link></Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

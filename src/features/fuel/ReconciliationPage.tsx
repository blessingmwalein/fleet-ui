import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { BadgeCheck, CalendarDays, Droplets, Eye, FileCheck2, Gauge, ListChecks, Scale, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, type Tone } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction } from '@/components/data-table/DataTable'
import { VehicleLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { Page, PageHeader } from '@/components/shared/Page'
import { CategoryBadge, Plate } from '@/components/shared/Status'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useBranchScope } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { VEHICLE_CATEGORY } from '@/config/status'
import { cn } from '@/lib/utils'
import { DeviationBar, FlagBadge, ReconciledBadge } from './components'
import { useFuelPerms, useFuelRows } from './hooks'
import { markReconciled, reportReconciled } from './actions'
import { avgPrice, monthOptions, reconcileStatements, reconcileVehicles, RECON_TOLERANCE_PCT, type ReconStatus, type StatementRecon, type VehicleRecon } from './lib'

const STATUS: Record<ReconStatus, { label: string; tone: Tone }> = {
  matched: { label: 'Matched', tone: 'success' },
  variance: { label: 'Variance', tone: 'warning' },
  flagged: { label: 'Flagged', tone: 'danger' },
  no_data: { label: 'Low mileage data', tone: 'neutral' },
}

const pctText = (p: number | null) => (p === null ? '—' : p > 300 ? '> +300%' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`)

export default function ReconciliationPage() {
  const money = useMoney()
  const perms = useFuelPerms()
  const { scope } = useBranchScope()
  const rows = useFuelRows()
  const invoices = useDb((s) => s.invoices)
  const months = useMemo(() => monthOptions(rows), [rows])
  const [month, setMonth] = useState<string>(() => months[1]?.value ?? months[0]?.value ?? '')
  const [tab, setTab] = useState('vehicles')
  const [openVehicle, setOpenVehicle] = useState<string | null>(null)
  const m = months.find((x) => x.value === month) ?? months[0]

  const scoped = useMemo(() => scope(rows), [rows, scope])
  const recon = useMemo(() => (m ? reconcileVehicles(scoped, m.start, m.end) : []), [scoped, m])
  const statements = useMemo(() => (m ? reconcileStatements(rows, invoices, m.start, m.end) : []), [rows, invoices, m])
  const open = recon.find((r) => r.vehicleId === openVehicle) ?? null

  const summary = useMemo(() => {
    const compared = recon.filter((r) => r.status !== 'no_data')
    const matched = compared.filter((r) => r.status === 'matched').length
    const excess = recon.reduce((a, r) => a + Math.max(0, r.varianceL), 0)
    const net = recon.reduce((a, r) => a + r.varianceL, 0)
    const price = avgPrice(recon.flatMap((r) => r.rows))
    const stmt = statements.reduce((a, s) => a + Math.abs(s.diffUsd ?? 0), 0)
    return {
      compared: compared.length,
      matchedPct: compared.length ? (matched / compared.length) * 100 : 0,
      excess,
      net,
      excessUsd: excess * price,
      stmt,
      unreconciled: recon.reduce((a, r) => a + r.unreconciled, 0),
      unreconciledUsd: recon.reduce((a, r) => a + r.rows.filter((x) => !x.reconciled).reduce((s, x) => s + x.totalUsd, 0), 0),
      flagged: recon.filter((r) => r.status === 'flagged').length,
    }
  }, [recon, statements])

  const reconcileRecon = (list: VehicleRecon[]) => {
    const [d, s] = markReconciled(list.flatMap((r) => r.rows.map((x) => x.id)), `Reconciled ${list.length} vehicle${list.length === 1 ? '' : 's'} for ${m?.label}`)
    reportReconciled(d, s)
  }

  const reconcileStatement = async (s: StatementRecon) => {
    if (s.status === 'variance' && !(await confirm({ title: `Reconcile ${s.provider} despite variance?`, description: `The statement differs from recorded transactions by ${money(s.diffUsd ?? 0, { digits: 2 })}. Transactions will be marked reconciled; investigate the difference with the provider.`, confirmLabel: 'Reconcile anyway' }))) return
    const [d, sk] = markReconciled(s.txIds, `Reconciled ${s.provider} ${m?.label} statement`)
    reportReconciled(d, sk)
  }

  const vehicleColumns = useMemo<ColumnDef<VehicleRecon, any>[]>(
    () => [
      { id: 'vehicle', header: 'Vehicle', size: 120, accessorFn: (r) => r.reg, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'category', header: 'Category', size: 140, accessorFn: (r) => (r.category ? VEHICLE_CATEGORY[r.category] : '—'), cell: ({ row }) => (row.original.category ? <CategoryBadge category={row.original.category} /> : '—'), meta: { hideBelow: 'lg' } },
      { id: 'fills', header: 'Fills', size: 65, accessorFn: (r) => r.fills, meta: { align: 'right' } },
      { id: 'purchased', header: 'Purchased', size: 100, accessorFn: (r) => Math.round(r.litres * 10) / 10, cell: ({ row }) => `${fmtNumber(row.original.litres, 1)} L`, meta: { align: 'right' } },
      { id: 'km', header: 'Distance', size: 95, accessorFn: (r) => r.km, cell: ({ row }) => `${fmtNumber(row.original.km)} km`, meta: { align: 'right' } },
      { id: 'expected', header: 'Expected', size: 100, accessorFn: (r) => Math.round(r.expectedL * 10) / 10, cell: ({ row }) => (row.original.expectedL ? `${fmtNumber(row.original.expectedL, 1)} L` : '—'), meta: { align: 'right' } },
      { id: 'varianceL', header: 'Variance L', size: 100, accessorFn: (r) => Math.round(r.varianceL * 10) / 10, cell: ({ row }) => (row.original.expectedL ? <span className={cn(row.original.varianceL > 0 ? 'text-danger' : 'text-success')}>{row.original.varianceL > 0 ? '+' : ''}{fmtNumber(row.original.varianceL, 1)}</span> : '—'), meta: { align: 'right' } },
      {
        id: 'variancePct',
        header: 'Variance %',
        size: 150,
        accessorFn: (r) => (r.variancePct === null ? undefined : Math.round(r.variancePct * 10) / 10),
        cell: ({ row }) => {
          const p = row.original.variancePct
          if (p === null) return <span className="text-subtle-foreground">—</span>
          return (
            <span className="flex items-center justify-end gap-2">
              <span className={cn('num w-16 text-right', Math.abs(p) > RECON_TOLERANCE_PCT ? (p > 0 ? 'text-danger' : 'text-warning') : 'text-success')}>{pctText(p)}</span>
              <DeviationBar value={p} max={60} className="w-14" />
            </span>
          )
        },
        meta: { align: 'right', exportValue: (r) => (r.variancePct === null ? '' : Number(r.variancePct.toFixed(1))) },
      },
      { id: 'spend', header: 'Recorded', size: 95, accessorFn: (r) => Math.round(r.spend), cell: ({ row }) => money(row.original.spend), meta: { align: 'right', exportValue: (r) => Math.round(r.spend) } },
      { id: 'unrec', header: 'Reconciled', size: 100, accessorFn: (r) => `${r.fills - r.unreconciled}/${r.fills}`, cell: ({ row }) => <span className={cn('num', row.original.unreconciled ? 'text-muted-foreground' : 'text-success')}>{row.original.fills - row.original.unreconciled}/{row.original.fills}</span>, meta: { align: 'right' } },
      { id: 'status', header: 'Status', size: 130, accessorFn: (r) => STATUS[r.status].label, cell: ({ row }) => <Badge tone={STATUS[row.original.status].tone}>{STATUS[row.original.status].label}</Badge> },
      actionsColumn<VehicleRecon>((r) => [
        { label: 'View fills', icon: <Eye />, onClick: () => setOpenVehicle(r.vehicleId) },
        { label: 'Mark reconciled', icon: <BadgeCheck />, hidden: !perms.canReview || r.unreconciled === 0, onClick: () => reconcileRecon([r]) },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, perms.canReview, m],
  )

  const bulk: BulkAction<VehicleRecon>[] = perms.canReview
    ? [{ label: 'Mark reconciled', icon: <BadgeCheck />, onClick: (sel, clear) => { reconcileRecon(sel); clear() } }]
    : []

  const statementColumns = useMemo<ColumnDef<StatementRecon, any>[]>(
    () => [
      { id: 'provider', header: 'Provider', size: 170, accessorFn: (r) => r.provider, cell: ({ row }) => <span className="font-medium">{row.original.provider}</span> },
      { id: 'invoice', header: 'Statement', size: 130, accessorFn: (r) => r.invoiceNumber ?? '—', cell: ({ row }) => (row.original.invoiceId ? <Link to={`/finance/invoices?open=${row.original.invoiceId}`} className="num hover:text-primary hover:underline">{row.original.invoiceNumber}</Link> : <span className="text-subtle-foreground">None</span>) },
      { id: 'inv_status', header: 'Invoice status', size: 120, accessorFn: (r) => r.invoiceStatus ?? '—', cell: ({ row }) => (row.original.invoiceStatus ? <Badge tone={row.original.invoiceStatus === 'paid' ? 'success' : row.original.invoiceStatus === 'overdue' ? 'danger' : 'info'} className="capitalize">{row.original.invoiceStatus}</Badge> : '—') },
      { id: 'statement', header: 'Statement $', size: 110, accessorFn: (r) => r.statementUsd ?? undefined, cell: ({ row }) => (row.original.statementUsd === null ? '—' : money(row.original.statementUsd, { digits: 2 })), meta: { align: 'right' } },
      { id: 'recorded', header: 'Recorded $', size: 110, accessorFn: (r) => Math.round(r.recordedUsd * 100) / 100, cell: ({ row }) => money(row.original.recordedUsd, { digits: 2 }), meta: { align: 'right' } },
      { id: 'diff', header: 'Difference', size: 105, accessorFn: (r) => (r.diffUsd === null ? undefined : Math.round(r.diffUsd * 100) / 100), cell: ({ row }) => (row.original.diffUsd === null ? '—' : <span className={cn(Math.abs(row.original.diffUsd) > 1 ? 'font-medium text-danger' : 'text-success')}>{row.original.diffUsd > 0 ? '+' : ''}{money(row.original.diffUsd, { digits: 2 })}</span>), meta: { align: 'right' } },
      { id: 'litres', header: 'Litres', size: 90, accessorFn: (r) => Math.round(r.recordedLitres), cell: ({ row }) => fmtNumber(row.original.recordedLitres), meta: { align: 'right' } },
      { id: 'fills', header: 'Fills', size: 65, accessorFn: (r) => r.fills, meta: { align: 'right' } },
      { id: 'unrec', header: 'Unreconciled', size: 110, accessorFn: (r) => r.unreconciled, meta: { align: 'right' } },
      { id: 'status', header: 'Status', size: 120, accessorFn: (r) => (r.status === 'matched' ? 'Matched' : r.status === 'variance' ? 'Variance' : 'No statement'), cell: ({ row }) => <Badge tone={row.original.status === 'matched' ? 'success' : row.original.status === 'variance' ? 'warning' : 'neutral'}>{row.original.status === 'matched' ? 'Matched' : row.original.status === 'variance' ? 'Variance' : 'No statement'}</Badge> },
      actionsColumn<StatementRecon>((r) => [{ label: 'Reconcile month', icon: <FileCheck2 />, hidden: !perms.canReview || r.unreconciled === 0, onClick: () => void reconcileStatement(r) }]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, perms.canReview, m],
  )

  return (
    <Page>
      <PageHeader
        title="Fuel reconciliation"
        description="Compare litres purchased with litres expected from distance driven, and card statements with recorded transactions."
        actions={
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-44" aria-label="Reconciliation month"><SelectValue /></SelectTrigger>
              <SelectContent>{months.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Matched vehicles" icon={ListChecks} value={summary.matchedPct} format={(n) => `${Math.round(n)}%`} status={summary.matchedPct >= 70 ? 'success' : summary.matchedPct >= 40 ? 'warning' : 'danger'} hint={`${summary.compared} vehicles compared (±${RECON_TOLERANCE_PCT}% tolerance)`} />
        <KpiCard label="Flagged vehicles" icon={Gauge} value={summary.flagged} status={summary.flagged ? 'danger' : 'success'} hint="Vehicles with open flagged fills" />
        <KpiCard label="Excess litres" icon={Droplets} value={summary.excess} format={(n) => fmtNumber(n)} unit="L" hint={`Net variance ${summary.net >= 0 ? '+' : ''}${fmtNumber(summary.net)} L (over-consumption minus under-consumption)`} />
        <KpiCard label="Excess value" icon={Scale} value={summary.excessUsd} format={(n) => money(n)} hint="Excess litres × average price paid" />
        <KpiCard label="Statement variance" icon={FileCheck2} value={summary.stmt} format={(n) => money(n, { digits: 2 })} status={summary.stmt > 1 ? 'warning' : 'success'} hint="Σ |statement − recorded| across providers" />
        <KpiCard label="Unreconciled fills" icon={Wallet} value={summary.unreconciled} hint={`${money(summary.unreconciledUsd)} not yet reconciled`} status={summary.unreconciled ? 'warning' : 'success'} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-3">
        <TabsList>
          <TabsTrigger value="vehicles">Litres vs expected <Badge tone="neutral">{recon.length}</Badge></TabsTrigger>
          <TabsTrigger value="statements">Card statements <Badge tone="neutral">{statements.length}</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles" className="pt-3">
          <DataTable
            tableId="fuel-recon-vehicles"
            data={recon}
            columns={vehicleColumns}
            getRowId={(r) => r.vehicleId}
            searchPlaceholder="Search vehicle…"
            facets={[{ columnId: 'status', label: 'Status', options: Object.values(STATUS).map((s) => ({ value: s.label, label: s.label })) }, { columnId: 'category', label: 'Category', options: Object.values(VEHICLE_CATEGORY).map((c) => ({ value: c, label: c })) }]}
            selectable={bulk.length > 0 || perms.canExport}
            bulkActions={bulk}
            exportName={perms.canExport ? `fuel-reconciliation-${m?.value ?? ''}` : undefined}
            defaultSort={[{ id: 'variancePct', desc: true }]}
            onRowClick={(r) => setOpenVehicle(r.vehicleId)}
            emptyTitle="No fuel purchases this month"
            emptyDescription="Pick another month or widen the branch scope."
            mobileCard={(r) => (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><Plate>{r.reg}</Plate><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></div>
                <div className="num flex justify-between text-xs text-muted-foreground"><span>{fmtNumber(r.litres, 1)} L bought · {fmtNumber(r.expectedL, 1)} L expected</span><span>{pctText(r.variancePct)}</span></div>
              </div>
            )}
          />
        </TabsContent>
        <TabsContent value="statements" className="pt-3">
          <p className="mb-2 text-xs text-muted-foreground">Provider statements (supplier invoices) versus transactions recorded for {m?.label}. Statements cover the whole company, so the branch scope is not applied here.</p>
          <DataTable
            tableId="fuel-recon-statements"
            data={statements}
            columns={statementColumns}
            getRowId={(r) => r.provider}
            bare
            exportName={undefined}
            emptyTitle="No statements for this month"
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex justify-between font-medium"><span>{r.provider}</span><span className="num">{r.statementUsd === null ? '—' : money(r.statementUsd, { digits: 2 })}</span></div>
                <div className="num flex justify-between text-xs text-muted-foreground"><span>Recorded {money(r.recordedUsd, { digits: 2 })}</span><span>{r.diffUsd === null ? 'No statement' : `Δ ${money(r.diffUsd, { digits: 2 })}`}</span></div>
              </div>
            )}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenVehicle(null)}>
        <SheetContent size="xl">
          {open && (
            <>
              <SheetHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <SheetTitle><Plate>{open.reg}</Plate> · {m?.label}</SheetTitle>
                  <Badge tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Badge>
                </div>
                <SheetDescription>
                  {fmtNumber(open.litres, 1)} L purchased · {open.expectedL ? `${fmtNumber(open.expectedL, 1)} L expected over ${fmtNumber(open.km)} km (${pctText(open.variancePct)})` : 'no comparable distance'} · {money(open.spend, { digits: 2 })}
                </SheetDescription>
              </SheetHeader>
              <SheetBody>
                <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                  {[...open.rows].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <Link to={`/fuel/transactions?open=${t.id}`} className="num font-medium hover:text-primary hover:underline">{t.ref}</Link>
                        <span className="text-subtle-foreground">{fmtDateTime(t.date)}</span>
                        <FlagBadge flag={t.flag} state={t.flagState} rule={t.rule} compact />
                      </span>
                      <span className="num flex items-center gap-3 text-muted-foreground">
                        <span>{fmtNumber(t.litres, 1)} L</span>
                        <span>{t.expectedL !== null ? `exp ${fmtNumber(t.expectedL, 1)} L` : 'no baseline'}</span>
                        {t.variancePct !== null && <span className={cn(t.variancePct > RECON_TOLERANCE_PCT ? 'text-danger' : 'text-success')}>{pctText(t.variancePct)}</span>}
                        <ReconciledBadge reconciled={t.reconciled} />
                      </span>
                    </li>
                  ))}
                </ul>
              </SheetBody>
              <SheetFooter>
                {perms.canReview && open.unreconciled > 0 && (
                  <Button onClick={() => reconcileRecon([open])}><BadgeCheck /> Mark {open.unreconciled} reconciled</Button>
                )}
                <Button variant="outline" onClick={() => setOpenVehicle(null)}>Close</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Page>
  )
}

void toast

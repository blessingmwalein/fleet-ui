import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { BadgeCheck, EyeOff, Eye, Plus, ScanSearch, Siren, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { DataTable, actionsColumn, type BulkAction } from '@/components/data-table/DataTable'
import { KpiCard } from '@/components/shared/KpiCard'
import { Page, PageHeader } from '@/components/shared/Page'
import { DriverLink, VehicleLink } from '@/components/shared/EntityLink'
import { Plate } from '@/components/shared/Status'
import { confirm } from '@/store/confirm'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useOpenParam } from '@/hooks/useLookup'
import { useMoney } from '@/hooks/useMoney'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FlagBadge, FLAG_STATE_LABEL, ReconciledBadge } from './components'
import { useFlagActions } from './FlagActions'
import { useFuelPerms, useFuelRows, useNewParam } from './hooks'
import { deleteTransactions, dismissMany, markReconciled, reportReconciled } from './actions'
import { FUEL_RULES, type FuelRow } from './lib'
import { TransactionDrawer } from './TransactionDrawer'
import { TransactionFormDialog } from './TransactionForm'

export default function TransactionsPage() {
  const money = useMoney()
  const range = useDateRange()
  const { scope } = useBranchScope()
  const perms = useFuelPerms()
  const rows = useFuelRows()
  const flags = useFlagActions()
  const [openId, setOpenId] = useOpenParam()
  const [formOpen, setFormOpen] = useState(false)
  const [period, setPeriod] = useState<'all' | 'range'>('all')
  useNewParam(() => setFormOpen(true), perms.canCreate)

  const data = useMemo(() => {
    const scoped = scope(rows)
    return period === 'range' ? scoped.filter((r) => range.inRange(r.date)) : scoped
  }, [rows, scope, period, range])
  const openRow = useMemo(() => (openId ? rows.find((r) => r.id === openId) ?? null : null), [rows, openId])

  const totals = useMemo(() => {
    let litres = 0
    let spend = 0
    let flagged = 0
    let pending = 0
    for (const r of data) {
      litres += r.litres
      spend += r.totalUsd
      if (r.flag) flagged++
      if (!r.reconciled) pending++
    }
    return { litres, spend, flagged, pending }
  }, [data])

  const facets = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }))
    return [
      { columnId: 'vehicle', label: 'Vehicle', options: uniq(rows.map((r) => r.reg)) },
      { columnId: 'station', label: 'Station', options: uniq(rows.map((r) => r.stationName)) },
      { columnId: 'brand', label: 'Brand', options: uniq(rows.map((r) => r.brand)) },
      { columnId: 'flagged', label: 'Flagged', options: [{ value: 'Flagged', label: 'Flagged' }, { value: 'Clear', label: 'Clear' }] },
      { columnId: 'reconciled', label: 'Reconciled', options: [{ value: 'Reconciled', label: 'Reconciled' }, { value: 'Pending', label: 'Pending' }] },
    ]
  }, [rows])

  const columns = useMemo<ColumnDef<FuelRow, any>[]>(
    () => [
      { id: 'ref', header: 'Ref', size: 100, accessorFn: (r) => r.ref, cell: ({ row }) => <span className="num font-medium">{row.original.ref}</span> },
      { id: 'date', header: 'Date', size: 160, accessorFn: (r) => r.date, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.date)}</span>, meta: { exportValue: (r) => r.date } },
      { id: 'vehicle', header: 'Vehicle', size: 110, accessorFn: (r) => r.reg, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'driver', header: 'Driver', size: 150, accessorFn: (r) => r.driverName, cell: ({ row }) => <DriverLink id={row.original.driverId} /> },
      { id: 'station', header: 'Station', size: 190, accessorFn: (r) => r.stationName },
      { id: 'brand', header: 'Brand', size: 120, accessorFn: (r) => r.brand, meta: { hideBelow: 'xl' } },
      { id: 'card', header: 'Card', size: 130, accessorFn: (r) => r.cardNumber || 'Cash', cell: ({ row }) => <span className="num text-muted-foreground">{row.original.cardNumber || 'Cash'}</span> },
      { id: 'litres', header: 'Litres', size: 85, accessorFn: (r) => r.litres, cell: ({ row }) => fmtNumber(row.original.litres, 1), meta: { align: 'right' } },
      { id: 'price', header: 'Price/L', size: 85, accessorFn: (r) => r.pricePerLitreUsd, cell: ({ row }) => money(row.original.pricePerLitreUsd, { digits: 2 }), meta: { align: 'right', exportValue: (r) => r.pricePerLitreUsd } },
      { id: 'total', header: 'Total', size: 95, accessorFn: (r) => r.totalUsd, cell: ({ row }) => <span className="font-medium">{money(row.original.totalUsd, { digits: 2 })}</span>, meta: { align: 'right', exportValue: (r) => r.totalUsd } },
      { id: 'odometer', header: 'Odometer', size: 105, accessorFn: (r) => r.odometerKm, cell: ({ row }) => `${fmtNumber(row.original.odometerKm)} km`, meta: { align: 'right' } },
      {
        id: 'l100',
        header: 'L/100 km',
        size: 95,
        accessorFn: (r) => r.l100 ?? undefined,
        cell: ({ row }) => {
          const r = row.original
          if (r.l100 === null) return <span className="text-subtle-foreground">—</span>
          return <span className={cn(!r.reliable ? 'text-subtle-foreground' : r.l100 > r.benchmark * 1.25 ? 'text-danger' : r.l100 < r.benchmark * 1.05 ? 'text-success' : '')}>{r.l100.toFixed(1)}</span>
        },
        meta: { align: 'right', exportValue: (r) => (r.l100 === null ? '' : Number(r.l100.toFixed(1))) },
      },
      { id: 'flagged', header: 'Flag', size: 150, accessorFn: (r) => (r.flag ? 'Flagged' : 'Clear'), cell: ({ row }) => <FlagBadge flag={row.original.flag} state={row.original.flagState} rule={row.original.rule} />, meta: { exportValue: (r) => (r.flag ? `${FUEL_RULES[r.rule ?? 'other'].label} (${FLAG_STATE_LABEL[r.flagState]})` : '') } },
      { id: 'reconciled', header: 'Status', size: 105, accessorFn: (r) => (r.reconciled ? 'Reconciled' : 'Pending'), cell: ({ row }) => <ReconciledBadge reconciled={row.original.reconciled} /> },
      actionsColumn<FuelRow>((r) => [
        { label: 'View details', icon: <Eye />, onClick: () => setOpenId(r.id) },
        { label: 'Mark reconciled', icon: <BadgeCheck />, hidden: !perms.canReview || r.reconciled, onClick: () => { const [d, s] = markReconciled([r.id]); reportReconciled(d, s) } },
        { label: 'Start review', icon: <ScanSearch />, hidden: !perms.canReview || !r.flag || r.flagState !== 'open', separatorBefore: true, onClick: () => flags.start('review', r) },
        { label: 'Dismiss flag', icon: <EyeOff />, hidden: !perms.canReview || !r.flag || r.flagState === 'escalated', onClick: () => flags.start('dismiss', r) },
        { label: 'Escalate to Safety', icon: <Siren />, hidden: !perms.canReview || !r.flag || r.flagState === 'escalated', onClick: () => flags.start('escalate', r) },
        { label: 'Delete', icon: <Trash2 />, destructive: true, hidden: !perms.canDelete, separatorBefore: true, onClick: () => void deleteTransactions([r]) },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, perms.canReview, perms.canDelete, flags.start],
  )

  const bulk: BulkAction<FuelRow>[] = [
    ...(perms.canReview
      ? [
          { label: 'Mark reconciled', icon: <BadgeCheck />, onClick: (sel: FuelRow[], clear: () => void) => { const [d, s] = markReconciled(sel.map((r) => r.id)); reportReconciled(d, s); clear() } },
          {
            label: 'Dismiss flags',
            icon: <EyeOff />,
            onClick: async (sel: FuelRow[], clear: () => void) => {
              const flagged = sel.filter((r) => r.flag)
              if (!flagged.length) return toast.info('None of the selected transactions are flagged')
              if (!(await confirm({ title: `Dismiss ${flagged.length} flag${flagged.length === 1 ? '' : 's'}?`, description: 'Flags are cleared as false positives and recorded in the audit log.', confirmLabel: 'Dismiss' }))) return
              toast.success(`${dismissMany(flagged, 'Bulk dismissed from the transactions list')} flags dismissed`)
              clear()
            },
          },
        ]
      : []),
    ...(perms.canDelete ? [{ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: async (sel: FuelRow[], clear: () => void) => { if (await deleteTransactions(sel)) clear() } }] : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Fuel transactions"
        description="Every fuel purchase with consumption analytics, detection flags and reconciliation status."
        actions={perms.canCreate && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus /> Add transaction
          </Button>
        )}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Transactions" value={data.length} format={(n) => fmtNumber(n)} />
        <KpiCard label="Litres" value={totals.litres} format={(n) => fmtNumber(n)} unit="L" />
        <KpiCard label="Spend" value={totals.spend} format={(n) => money(n)} />
        <KpiCard label="Flagged · pending" value={`${totals.flagged} · ${totals.pending}`} status={totals.flagged ? 'warning' : 'success'} />
      </div>
      <DataTable
        tableId="fuel-transactions"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search ref, vehicle, driver, station, receipt…"
        facets={facets}
        selectable={bulk.length > 0 || perms.canExport}
        bulkActions={bulk}
        exportName={perms.canExport ? 'fuel-transactions' : undefined}
        defaultSort={[{ id: 'date', desc: true }]}
        defaultHidden={['card', 'odometer']}
        onRowClick={(r) => setOpenId(r.id)}
        rowClassName={(r) => (r.flag && r.flagState !== 'escalated' ? 'bg-warning/5' : undefined)}
        toolbar={
          <Segmented
            aria-label="Period"
            value={period}
            onChange={setPeriod}
            options={[{ value: 'all', label: 'All time' }, { value: 'range', label: range.label }]}
          />
        }
        emptyTitle="No fuel transactions"
        emptyDescription="Adjust the filters, or add a transaction."
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Plate>{r.reg}</Plate><span className="num text-xs text-muted-foreground">{r.ref}</span></span>
              <span className="num font-medium">{money(r.totalUsd, { digits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{r.stationName}</span>
              <span className="num shrink-0">{fmtNumber(r.litres, 1)} L</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
              <span>{fmtDateTime(r.date)}</span>
              <FlagBadge flag={r.flag} state={r.flagState} rule={r.rule} compact />
              <ReconciledBadge reconciled={r.reconciled} />
            </div>
          </div>
        )}
      />
      <TransactionDrawer row={openRow} allRows={rows} onClose={() => setOpenId(null)} onOpen={(id) => setOpenId(id)} flags={flags} />
      <TransactionFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={(id) => setOpenId(id)} />
      {flags.dialogs}
    </Page>
  )
}

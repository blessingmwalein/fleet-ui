import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, BadgeCheck, Banknote, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Expense } from '@/types'
import { useDb } from '@/store/db'
import { useById, useOpenParam } from '@/hooks/useLookup'
import { useCan } from '@/hooks/useAuth'
import { useBranchScope } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { EXPENSE_CATEGORY } from '@/config/status'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction, type RowAction } from '@/components/data-table/DataTable'
import { DetailGrid, Page, PageHeader, Panel, Timeline, type TimelineItem } from '@/components/shared/Page'
import { Status } from '@/components/shared/Status'
import { DriverLink, EntityLink, TripLink, VehicleLink, BranchLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ColumnDef } from '@tanstack/react-table'
import { RejectExpenseDialog, useExpenseActions } from './expenseActions'
import { ExpenseFormDialog } from './ExpenseForm'
import { Stat } from './ui'

interface ExpenseRow extends Expense {
  vehicleReg: string
  tripRef: string
  driverName: string
  branchName: string
  categoryLabel: string
  statusLabel: string
  methodLabel: string
}

const METHOD_LABEL: Record<Expense['paymentMethod'], string> = { cash: 'Cash', fuel_card: 'Fuel card', bank_transfer: 'Bank transfer', ecocash: 'EcoCash', card: 'Company card' }
const STATUS_LABEL: Record<Expense['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', paid: 'Paid' }
const STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const
type Tab = 'all' | (typeof STATUSES)[number]

export default function ExpensesPage() {
  const money = useMoney()
  const expenses = useDb((s) => s.expenses)
  const branches = useDb((s) => s.branches)
  const getVehicle = useById('vehicles')
  const getTrip = useById('trips')
  const getDriver = useById('drivers')
  const { scope } = useBranchScope()
  const canCreate = useCan('finance.create')
  const canEdit = useCan('finance.edit')
  const canApprove = useCan('finance.approve')
  const canDelete = useCan('finance.delete')
  const canExport = useCan('finance.export')
  const actions = useExpenseActions()
  const [params, setParams] = useSearchParams()
  const [openId, setOpenId] = useOpenParam()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [rejecting, setRejecting] = useState<Expense[] | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  // ?new=1 deep link
  useEffect(() => {
    if (params.get('new') === '1') {
      if (canCreate) {
        setEditing(null)
        setFormOpen(true)
      }
      setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
    }
  }, [params, canCreate, setParams])

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const enriched = useMemo<ExpenseRow[]>(
    () => expenses.map((e) => ({
      ...e,
      vehicleReg: getVehicle(e.vehicleId)?.reg ?? '',
      tripRef: getTrip(e.tripId)?.ref ?? '',
      driverName: getDriver(e.driverId)?.name ?? '',
      branchName: branchName.get(e.branchId) ?? '',
      categoryLabel: EXPENSE_CATEGORY[e.category],
      statusLabel: STATUS_LABEL[e.status],
      methodLabel: METHOD_LABEL[e.paymentMethod],
    })),
    [expenses, getVehicle, getTrip, getDriver, branchName],
  )
  const rows = useMemo(() => scope(enriched), [enriched, scope])
  const opened = useMemo(() => (openId ? enriched.find((e) => e.id === openId) ?? null : null), [openId, enriched])

  useEffect(() => {
    if (openId && !enriched.find((e) => e.id === openId) && enriched.length) setOpenId(null)
  }, [openId, enriched, setOpenId])

  const stats = useMemo(() => {
    const m = Object.fromEntries(STATUSES.map((s) => [s, { n: 0, amount: 0 }])) as Record<(typeof STATUSES)[number], { n: number; amount: number }>
    for (const e of rows) {
      m[e.status].n += 1
      m[e.status].amount += e.amountUsd
    }
    return m
  }, [rows])
  const allTotal = rows.reduce((s, e) => s + e.amountUsd, 0)

  const rowActions = (e: ExpenseRow): RowAction[] => [
    { label: 'View details', icon: <BadgeCheck />, onClick: () => setOpenId(e.id) },
    { label: 'Approve', icon: <Check />, onClick: () => void actions.approve([e]), hidden: !(canApprove && e.status === 'pending'), separatorBefore: true },
    { label: 'Reject…', icon: <X />, onClick: () => setRejecting([e]), hidden: !(canApprove && e.status === 'pending') },
    { label: 'Mark as paid', icon: <Banknote />, onClick: () => void actions.pay([e]), hidden: !(canApprove && e.status === 'approved') },
    { label: e.status === 'rejected' ? 'Edit & resubmit' : 'Edit', icon: <Pencil />, onClick: () => { setEditing(e); setFormOpen(true) }, hidden: !(canEdit && (e.status === 'pending' || e.status === 'rejected')), separatorBefore: true },
    { label: 'Delete', icon: <Trash2 />, destructive: true, onClick: () => void actions.remove([e]), hidden: !(canDelete && (e.status === 'pending' || e.status === 'rejected')) },
  ]

  const columns = useMemo<ColumnDef<ExpenseRow, any>[]>(
    () => [
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Ref', size: 92, meta: { label: 'Reference' }, cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.ref}</span> },
      { id: 'date', accessorFn: (r) => r.date, header: 'Date', size: 100, cell: ({ row }) => <span className="num">{fmtDate(row.original.date)}</span>, meta: { exportValue: (r) => r.date.slice(0, 10) } },
      { id: 'category', accessorFn: (r) => r.categoryLabel, header: 'Category', size: 120 },
      { id: 'description', accessorFn: (r) => r.description, header: 'Description', size: 270, cell: ({ row }) => <span title={row.original.description}>{row.original.description}</span> },
      { id: 'vehicle', accessorFn: (r) => r.vehicleReg, header: 'Vehicle', size: 100, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'trip', accessorFn: (r) => r.tripRef, header: 'Trip', size: 118, cell: ({ row }) => <TripLink id={row.original.tripId} /> },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 140, cell: ({ row }) => <DriverLink id={row.original.driverId} /> },
      { id: 'amount', accessorFn: (r) => r.amountUsd, header: 'Amount', size: 100, meta: { align: 'right', label: 'Amount (USD)' }, cell: ({ row }) => <span className="font-medium">{money(row.original.amountUsd, { digits: 2 })}</span> },
      { id: 'supplier', accessorFn: (r) => r.supplier, header: 'Supplier', size: 150 },
      { id: 'status', accessorFn: (r) => r.statusLabel, header: 'Status', size: 104, cell: ({ row }) => <Status kind="expense" value={row.original.status} /> },
      { id: 'submittedBy', accessorFn: (r) => r.submittedBy, header: 'Submitted by', size: 140 },
      { id: 'branch', accessorFn: (r) => r.branchName, header: 'Branch', size: 160, cell: ({ row }) => <BranchLink id={row.original.branchId} /> },
      { id: 'method', accessorFn: (r) => r.methodLabel, header: 'Payment', size: 110 },
      { id: 'receipt', accessorFn: (r) => r.receiptNo ?? '', header: 'Receipt no.', size: 110 },
      { id: 'approvedBy', accessorFn: (r) => r.approvedBy ?? '', header: 'Approved by', size: 140 },
      actionsColumn<ExpenseRow>(rowActions),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, canApprove, canEdit, canDelete],
  )

  const bulk: BulkAction<ExpenseRow>[] = [
    ...(canApprove
      ? [
          { label: 'Approve', icon: <Check />, onClick: (r: ExpenseRow[], clear: () => void) => void actions.approve(r).then((n) => n && clear()) },
          { label: 'Reject…', icon: <X />, onClick: (r: ExpenseRow[]) => { const p = r.filter((x) => x.status === 'pending'); if (p.length) setRejecting(p); else toast.info('Select pending expenses to reject') } },
          { label: 'Mark paid', icon: <Banknote />, onClick: (r: ExpenseRow[], clear: () => void) => void actions.pay(r).then((n) => n && clear()) },
        ]
      : []),
    ...(canDelete ? [{ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: (r: ExpenseRow[], clear: () => void) => void actions.remove(r).then((n) => n && clear()) }] : []),
  ]

  const facets = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort().map((v) => ({ value: v, label: v }))
    return [
      { columnId: 'category', label: 'Category', options: uniq(Object.values(EXPENSE_CATEGORY)) },
      { columnId: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: STATUS_LABEL[s], label: STATUS_LABEL[s] })) },
      { columnId: 'branch', label: 'Branch', options: uniq(rows.map((r) => r.branchName)) },
    ]
  }, [rows])

  return (
    <Page>
      <PageHeader
        title="Expenses"
        description="Submit, review and approve trip and fleet expense claims. Approved claims are paid out and flow into operating cost and vehicle profitability."
        actions={canCreate && <Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus /> New expense</Button>}
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="All expenses" value={money(allTotal, { compact: true })} sub={`${rows.length.toLocaleString()} claims`} active={tab === 'all'} onClick={() => setTab('all')} />
        {STATUSES.map((s) => (
          <Stat key={s} label={STATUS_LABEL[s]} value={money(stats[s].amount, { compact: true })} sub={`${stats[s].n.toLocaleString()} claims`} tone={s === 'pending' ? 'warning' : s === 'approved' ? 'info' : s === 'paid' ? 'success' : 'danger'} active={tab === s} onClick={() => setTab(s)} />
        ))}
      </div>

      <DataTable<ExpenseRow>
        key={tab}
        tableId="finance.expenses"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        exportName={canExport ? 'expenses' : undefined}
        searchPlaceholder="Search ref, description, vehicle, supplier…"
        facets={facets}
        initialFilters={tab === 'all' ? [] : [{ id: 'status', value: [STATUS_LABEL[tab]] }]}
        defaultSort={[{ id: 'date', desc: true }]}
        defaultHidden={['branch', 'method', 'receipt', 'approvedBy', 'submittedBy']}
        selectable={bulk.length > 0}
        bulkActions={bulk}
        onRowClick={(r) => setOpenId(r.id)}
        rowClassName={(r) => (r.status === 'pending' ? 'bg-warning/[0.03]' : undefined)}
        emptyTitle="No expenses match"
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-medium">{r.ref}</span>
              <Status kind="expense" value={r.status} />
            </div>
            <p className="truncate text-[13px]">{r.description}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{fmtDate(r.date)} · {r.categoryLabel}{r.vehicleReg ? ` · ${r.vehicleReg}` : ''}</span>
              <span className="num text-sm font-semibold text-foreground">{money(r.amountUsd, { digits: 2 })}</span>
            </div>
          </div>
        )}
      />

      <ExpenseDrawer
        expense={opened}
        all={enriched}
        onClose={() => setOpenId(null)}
        onReject={(e) => setRejecting([e])}
        onEdit={(e) => { setEditing(e); setFormOpen(true) }}
      />
      <ExpenseFormDialog open={formOpen} onOpenChange={setFormOpen} expense={editing} />
      <RejectExpenseDialog rows={rejecting} onClose={() => setRejecting(null)} />
    </Page>
  )
}

function ExpenseDrawer({ expense, all, onClose, onReject, onEdit }: { expense: ExpenseRow | null; all: ExpenseRow[]; onClose: () => void; onReject: (e: ExpenseRow) => void; onEdit: (e: ExpenseRow) => void }) {
  const money = useMoney()
  const actions = useExpenseActions()
  const canApprove = useCan('finance.approve')
  const canEdit = useCan('finance.edit')
  const canDelete = useCan('finance.delete')
  const auditLog = useDb((s) => s.auditLog)
  const getTrip = useById('trips')
  // keep the last record rendered while the sheet animates closed
  const [last, setLast] = useState<ExpenseRow | null>(null)
  useEffect(() => { if (expense) setLast(expense) }, [expense])
  const e = expense ?? last
  const trip = getTrip(e?.tripId)
  const related = useMemo(() => (e?.tripId ? all.filter((x) => x.tripId === e.tripId && x.status !== 'rejected') : []), [all, e?.tripId])
  const trail = useMemo(() => (e ? auditLog.filter((a) => a.entityType === 'expense' && a.entityId === e.id).slice(0, 8) : []), [auditLog, e])
  if (!e) return null

  const timeline: TimelineItem[] = [{ id: 'sub', title: `Submitted by ${e.submittedBy}`, time: fmtDateTime(e.date), done: true }]
  if (e.status === 'rejected') timeline.push({ id: 'rej', title: 'Rejected', description: e.rejectionReason ?? 'No reason recorded', tone: 'danger', done: true })
  else if (e.status === 'pending') timeline.push({ id: 'pend', title: 'Awaiting approval', done: false })
  else timeline.push({ id: 'app', title: `Approved${e.approvedBy ? ` by ${e.approvedBy}` : ''}`, done: true })
  if (e.status === 'paid') timeline.push({ id: 'paid', title: 'Paid out', done: true })
  else if (e.status === 'approved') timeline.push({ id: 'topay', title: 'Awaiting payment', done: false })

  const relatedTotal = related.reduce((s, x) => s + x.amountUsd, 0)
  const noReceipt = !e.receiptNo && e.amountUsd >= 50

  return (
    <Sheet open={!!expense} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="font-mono">{e.ref}</SheetTitle>
            <Status kind="expense" value={e.status} />
          </div>
          <SheetDescription>{e.categoryLabel} · {fmtDate(e.date)}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <div className="flex items-end justify-between gap-3 rounded-lg border border-border bg-surface-2/50 px-4 py-3">
            <div>
              <div className="label-xs">Amount</div>
              <div className="num text-2xl font-semibold tracking-tight">{money(e.amountUsd, { digits: 2 })}</div>
            </div>
            <p className="max-w-[60%] text-right text-[13px] text-muted-foreground">{e.description}</p>
          </div>
          {noReceipt && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0" /> No receipt number captured — policy requires a receipt for claims over $50.
            </div>
          )}
          {e.status === 'rejected' && e.rejectionReason && (
            <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <X className="size-3.5 shrink-0" /> Rejected: {e.rejectionReason}
            </div>
          )}
          <DetailGrid
            columns={2}
            items={[
              { label: 'Supplier / payee', value: e.supplier },
              { label: 'Payment method', value: e.methodLabel },
              { label: 'Receipt no.', value: e.receiptNo ?? '—' },
              { label: 'Submitted by', value: e.submittedBy },
              { label: 'Vehicle', value: <VehicleLink id={e.vehicleId} /> },
              { label: 'Driver', value: <DriverLink id={e.driverId} /> },
              { label: 'Trip', value: <TripLink id={e.tripId} /> },
              { label: 'Branch', value: <BranchLink id={e.branchId} /> },
            ]}
          />
          {trip && (
            <Panel title="Trip economics" description={`${trip.origin.city} → ${trip.destination.city}`} bodyClassName="p-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><div className="label-xs">Revenue</div><div className="num text-[15px] font-semibold">{money(trip.revenueUsd)}</div></div>
                <div><div className="label-xs">Claims on trip</div><div className="num text-[15px] font-semibold">{money(relatedTotal, { digits: 2 })}</div><div className="text-[11px] text-subtle-foreground">{related.length} claim{related.length === 1 ? '' : 's'}</div></div>
                <div><div className="label-xs">After claims</div><div className={`num text-[15px] font-semibold ${trip.revenueUsd - relatedTotal < 0 ? 'text-danger' : 'text-success'}`}>{money(trip.revenueUsd - relatedTotal)}</div></div>
              </div>
              {related.length > 1 && (
                <ul className="mt-3 divide-y divide-border border-t border-border text-xs">
                  {related.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate"><EntityLink type="expense" id={x.id} className={x.id === e.id ? 'font-semibold' : ''} /> <span className="text-subtle-foreground">· {x.categoryLabel}</span></span>
                      <span className="num">{money(x.amountUsd, { digits: 2 })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <div>
            <h3 className="label-xs mb-2">Approval workflow</h3>
            <Timeline items={timeline} />
          </div>
          {trail.length > 0 && (
            <div>
              <h3 className="label-xs mb-2">Audit trail</h3>
              <ul className="space-y-1.5 text-xs">
                {trail.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground"><span className="font-medium text-foreground">{a.userName}</span> — {a.summary}</span>
                    <span className="shrink-0 text-subtle-foreground">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {related.length === 0 && !trip && <EmptyState compact title="Not linked to a trip" description="Link claims to trips so they count toward trip and customer profitability." />}
        </SheetBody>
        <SheetFooter>
          {canDelete && (e.status === 'pending' || e.status === 'rejected') && <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => void actions.remove([e]).then((n) => n && onClose())}><Trash2 /> Delete</Button>}
          {canEdit && (e.status === 'pending' || e.status === 'rejected') && <Button variant="outline" onClick={() => { onClose(); onEdit(e) }}><Pencil /> {e.status === 'rejected' ? 'Edit & resubmit' : 'Edit'}</Button>}
          {canApprove && e.status === 'pending' && (
            <>
              <Button variant="outline" onClick={() => onReject(e)}><X /> Reject</Button>
              <Button onClick={() => void actions.approve([e])}><Check /> Approve</Button>
            </>
          )}
          {canApprove && e.status === 'approved' && <Button onClick={() => void actions.pay([e])}><Banknote /> Mark as paid</Button>}
          {e.status === 'paid' && <Badge tone="success">Settled</Badge>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

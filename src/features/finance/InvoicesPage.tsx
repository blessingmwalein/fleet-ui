import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Banknote, Check, Download, Eye, Plus, Send, Trash2 } from 'lucide-react'
import type { Invoice } from '@/types'
import { useDb } from '@/store/db'
import { useById, useOpenParam } from '@/hooks/useLookup'
import { useCan } from '@/hooks/useAuth'
import { useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { downloadObjectsCsv } from '@/lib/csv'
import { fmtDate, fmtNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction, type RowAction } from '@/components/data-table/DataTable'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { BranchLink, CustomerLink, TripLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { BulkPaymentDialog, CustomerInvoiceDialog, PaymentDialog, SupplierInvoiceDialog, useInvoiceActions } from './invoiceActions'
import { useInvoices } from './hooks'
import { daysPastDue, effectiveInvoiceStatus, invoiceBalance } from './lib'
import { DueDate, InvoiceStatusBadge, Stat } from './ui'

interface InvRow extends Invoice {
  eff: Invoice['status']
  effLabel: string
  balance: number
  dpd: number
  branchName: string
  tripCount: number
}

const STATUS_LABEL = { customer: { draft: 'Draft', sent: 'Sent', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue' }, supplier: { draft: 'Pending approval', sent: 'Approved', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue' } } as const

export default function InvoicesPage() {
  const [params, setParams] = useSearchParams()
  const [openId, setOpenId] = useOpenParam()
  const canCreate = useCan('finance.create')
  const { all } = useInvoices()
  const [custOpen, setCustOpen] = useState(false)
  const [supOpen, setSupOpen] = useState(false)
  const tab = (params.get('tab') === 'supplier' ? 'supplier' : 'customer') as Invoice['kind']
  const setTab = (t: Invoice['kind']) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('open'); return n }, { replace: true })

  // ?new=1 deep link (add &tab=supplier for a supplier invoice)
  useEffect(() => {
    if (params.get('new') === '1') {
      if (canCreate) (params.get('tab') === 'supplier' ? setSupOpen : setCustOpen)(true)
      setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
    }
  }, [params, canCreate, setParams])

  // ?open=<id> switches to the right tab
  const openedInv = openId ? all.find((i) => i.id === openId) : undefined
  useEffect(() => {
    if (openedInv && openedInv.kind !== tab) setParams((p) => { const n = new URLSearchParams(p); n.set('tab', openedInv.kind); return n }, { replace: true })
  }, [openedInv, tab, setParams])
  useEffect(() => {
    if (openId && all.length && !openedInv) setOpenId(null)
  }, [openId, openedInv, all.length, setOpenId])

  return (
    <Page>
      <PageHeader
        title="Invoices"
        description="Bill customers for delivered trips and track receivables; capture supplier bills and manage payables through to payment."
        actions={canCreate && <Button onClick={() => (tab === 'supplier' ? setSupOpen(true) : setCustOpen(true))}><Plus /> {tab === 'supplier' ? 'Supplier invoice' : 'Customer invoice'}</Button>}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Invoice['kind'])} className="mb-3">
        <TabsList variant="pills">
          <TabsTrigger value="customer">Customer invoices (receivables)</TabsTrigger>
          <TabsTrigger value="supplier">Supplier invoices (payables)</TabsTrigger>
        </TabsList>
      </Tabs>
      <InvoiceTable key={tab} kind={tab} onOpen={setOpenId} onNew={() => (tab === 'supplier' ? setSupOpen(true) : setCustOpen(true))} />
      <InvoiceDrawer invoiceId={openId} onClose={() => setOpenId(null)} />
      <CustomerInvoiceDialog open={custOpen} onOpenChange={setCustOpen} onCreated={(i) => { setTab('customer'); setOpenId(i.id) }} />
      <SupplierInvoiceDialog open={supOpen} onOpenChange={setSupOpen} onCreated={(i) => { setTab('supplier'); setOpenId(i.id) }} />
    </Page>
  )
}

function useInvRows(kind: Invoice['kind']) {
  const { scoped, all } = useInvoices()
  const branches = useDb((s) => s.branches)
  const bn = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const build = (list: Invoice[]): InvRow[] => {
    const now = Date.now()
    return list.filter((i) => i.kind === kind).map((i) => {
      const eff = effectiveInvoiceStatus(i, now)
      return { ...i, eff, effLabel: STATUS_LABEL[kind][eff], balance: invoiceBalance(i), dpd: daysPastDue(i, now), branchName: bn.get(i.branchId) ?? '', tripCount: i.tripIds.length }
    })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => build(scoped), [scoped, bn, kind])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allRows = useMemo(() => build(all), [all, bn, kind])
  return { rows, allRows }
}

function InvoiceTable({ kind, onOpen, onNew }: { kind: Invoice['kind']; onOpen: (id: string) => void; onNew: () => void }) {
  const money = useMoney()
  const range = useDateRange()
  const canCreate = useCan('finance.create')
  const canEdit = useCan('finance.edit')
  const canApprove = useCan('finance.approve')
  const canDelete = useCan('finance.delete')
  const canExport = useCan('finance.export')
  const actions = useInvoiceActions()
  const { rows } = useInvRows(kind)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [bulkPay, setBulkPay] = useState<Invoice[] | null>(null)
  const customer = kind === 'customer'
  const releasePerm = customer ? canEdit : canApprove

  const stats = useMemo(() => {
    const now = Date.now()
    let outstanding = 0, overdue = 0, overdueN = 0, soon = 0, soonN = 0, drafts = 0, draftN = 0, collected = 0
    for (const r of rows) {
      if (r.eff === 'draft') { drafts += r.amountUsd; draftN++; continue }
      for (const p of r.payments) if (range.inRange(p.date)) collected += p.amountUsd
      if (r.balance <= 0) continue
      outstanding += r.balance
      if (r.eff === 'overdue') { overdue += r.balance; overdueN++ }
      else if (new Date(r.dueDate).getTime() - now < 7 * 864e5) { soon += r.balance; soonN++ }
    }
    return { outstanding, overdue, overdueN, soon, soonN, drafts, draftN, collected }
  }, [rows, range])

  const rowActions = (r: InvRow): RowAction[] => [
    { label: 'View details', icon: <Eye />, onClick: () => onOpen(r.id) },
    { label: customer ? 'Send to customer' : 'Approve for payment', icon: customer ? <Send /> : <Check />, onClick: () => void actions.release([r]), hidden: !(releasePerm && r.status === 'draft'), separatorBefore: true },
    { label: customer ? 'Record receipt' : 'Record payment', icon: <Banknote />, onClick: () => setPaying(r), hidden: !(canEdit && r.status !== 'draft' && r.balance > 0) },
    { label: 'Delete draft', icon: <Trash2 />, destructive: true, onClick: () => void actions.remove([r]), hidden: !(canDelete && r.status === 'draft' && r.paidUsd === 0), separatorBefore: true },
  ]

  const columns = useMemo<ColumnDef<InvRow, any>[]>(
    () => [
      { id: 'number', accessorFn: (r) => r.number, header: 'Invoice', size: 118, cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.number}</span> },
      { id: 'party', accessorFn: (r) => r.partyName, header: customer ? 'Customer' : 'Supplier', size: 210, cell: ({ row }) => (customer ? <CustomerLink id={row.original.partyId} /> : <span>{row.original.partyName}</span>) },
      { id: 'description', accessorFn: (r) => r.description, header: 'Description', size: 250 },
      { id: 'issue', accessorFn: (r) => r.issueDate, header: 'Issued', size: 100, cell: ({ row }) => <span className="num">{fmtDate(row.original.issueDate)}</span>, meta: { exportValue: (r) => r.issueDate.slice(0, 10) } },
      { id: 'due', accessorFn: (r) => r.dueDate, header: 'Due', size: 116, cell: ({ row }) => <DueDate inv={row.original} />, meta: { exportValue: (r) => r.dueDate.slice(0, 10) } },
      { id: 'amount', accessorFn: (r) => r.amountUsd, header: 'Amount', size: 100, meta: { align: 'right', label: 'Amount (USD)' }, cell: ({ row }) => money(row.original.amountUsd) },
      { id: 'paid', accessorFn: (r) => r.paidUsd, header: customer ? 'Received' : 'Paid', size: 100, meta: { align: 'right', label: 'Paid (USD)' }, cell: ({ row }) => <span className="text-muted-foreground">{money(row.original.paidUsd)}</span> },
      { id: 'balance', accessorFn: (r) => r.balance, header: 'Balance', size: 100, meta: { align: 'right', label: 'Balance (USD)' }, cell: ({ row }) => <span className={row.original.balance > 0 ? 'font-medium' : 'text-subtle-foreground'}>{money(row.original.balance)}</span> },
      { id: 'status', accessorFn: (r) => r.effLabel, header: 'Status', size: 132, cell: ({ row }) => <InvoiceStatusBadge status={row.original.eff} kind={kind} /> },
      ...(customer ? [{ id: 'trips', accessorFn: (r: InvRow) => r.tripCount, header: 'Trips', size: 64, meta: { align: 'right' as const } } as ColumnDef<InvRow, any>] : []),
      { id: 'branch', accessorFn: (r) => r.branchName, header: 'Branch', size: 160, cell: ({ row }) => <BranchLink id={row.original.branchId} /> },
      actionsColumn<InvRow>(rowActions),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, kind, canEdit, canApprove, canDelete],
  )

  const bulk: BulkAction<InvRow>[] = [
    ...(releasePerm ? [{ label: customer ? 'Send' : 'Approve', icon: customer ? <Send /> : <Check />, onClick: (r: InvRow[], clear: () => void) => void actions.release(r).then((n) => n && clear()) }] : []),
    ...(canEdit ? [{ label: customer ? 'Record receipts' : 'Pay selected', icon: <Banknote />, onClick: (r: InvRow[]) => setBulkPay(r) }] : []),
    ...(canDelete ? [{ label: 'Delete drafts', icon: <Trash2 />, destructive: true, onClick: (r: InvRow[], clear: () => void) => void actions.remove(r).then((n) => n && clear()) }] : []),
  ]

  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort().map((v) => ({ value: v, label: v }))
  const facets = [
    { columnId: 'status', label: 'Status', options: Object.values(STATUS_LABEL[kind]).map((l) => ({ value: l, label: l })) },
    { columnId: 'party', label: customer ? 'Customer' : 'Supplier', options: uniq(rows.map((r) => r.partyName)) },
    { columnId: 'branch', label: 'Branch', options: uniq(rows.map((r) => r.branchName)) },
  ]

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label={customer ? 'Receivables outstanding' : 'Payables outstanding'} value={money(stats.outstanding, { compact: true })} sub={`${rows.filter((r) => r.eff !== 'draft' && r.balance > 0).length} open invoices`} />
        <Stat label="Overdue" value={money(stats.overdue, { compact: true })} sub={`${stats.overdueN} invoice${stats.overdueN === 1 ? '' : 's'} past due`} tone={stats.overdue > 0 ? 'danger' : undefined} />
        <Stat label="Due within 7 days" value={money(stats.soon, { compact: true })} sub={`${stats.soonN} invoice${stats.soonN === 1 ? '' : 's'}`} tone={stats.soon > 0 ? 'warning' : undefined} />
        <Stat label={customer ? 'Collected in period' : 'Paid in period'} value={money(stats.collected, { compact: true })} sub={range.label} tone="success" />
        <Stat label={customer ? 'Drafts' : 'Pending approval'} value={money(stats.drafts, { compact: true })} sub={`${stats.draftN} invoice${stats.draftN === 1 ? '' : 's'}`} />
      </div>
      <DataTable<InvRow>
        tableId={`finance.invoices.${kind}`}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        exportName={canExport ? (customer ? 'customer-invoices' : 'supplier-invoices') : undefined}
        searchPlaceholder={customer ? 'Search invoice, customer, description…' : 'Search invoice, supplier, description…'}
        facets={facets}
        defaultSort={[{ id: 'issue', desc: true }]}
        defaultHidden={['description', 'branch']}
        selectable={bulk.length > 0}
        bulkActions={bulk}
        onRowClick={(r) => onOpen(r.id)}
        rowClassName={(r) => (r.eff === 'overdue' ? 'bg-danger/[0.045]' : undefined)}
        emptyTitle={customer ? 'No customer invoices' : 'No supplier invoices'}
        emptyDescription="Invoices in the selected branch scope will appear here."
        actions={canCreate && <Button size="sm" onClick={onNew}><Plus /> {customer ? 'New invoice' : 'Supplier invoice'}</Button>}
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-medium">{r.number}</span>
              <InvoiceStatusBadge status={r.eff} kind={kind} />
            </div>
            <p className="truncate text-[13px]">{r.partyName}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Due <DueDate inv={r} /></span>
              <span className="num text-sm font-semibold text-foreground">{money(r.balance > 0 ? r.balance : r.amountUsd)}</span>
            </div>
          </div>
        )}
      />
      <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
      <BulkPaymentDialog invoices={bulkPay} onClose={() => setBulkPay(null)} />
    </>
  )
}

function InvoiceDrawer({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const money = useMoney()
  const actions = useInvoiceActions()
  const canEdit = useCan('finance.edit')
  const canApprove = useCan('finance.approve')
  const canDelete = useCan('finance.delete')
  const canExport = useCan('finance.export')
  const { all } = useInvoices()
  const getTrip = useById('trips')
  const [paying, setPaying] = useState<Invoice | null>(null)
  const live = invoiceId ? all.find((i) => i.id === invoiceId) ?? null : null
  const [last, setLast] = useState<Invoice | null>(null)
  useEffect(() => { if (live) setLast(live) }, [live])
  const inv = live ?? last
  if (!inv) return null
  const now = Date.now()
  const eff = effectiveInvoiceStatus(inv, now)
  const balance = invoiceBalance(inv)
  const dpd = daysPastDue(inv, now)
  const customer = inv.kind === 'customer'
  const trips = inv.tripIds.map((id) => getTrip(id)).filter((t): t is NonNullable<typeof t> => !!t)
  const paidPct = inv.amountUsd > 0 ? Math.min(100, (inv.paidUsd / inv.amountUsd) * 100) : 0

  const exportCsv = () =>
    downloadObjectsCsv(`${inv.number}-lines`, customer ? trips : [], {
      Trip: (t) => t.ref, Delivered: (t) => (t.actualEnd ?? '').slice(0, 10), Origin: (t) => t.origin.city, Destination: (t) => t.destination.city, 'Revenue (USD)': (t) => t.revenueUsd,
    })

  return (
    <Sheet open={!!live} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="font-mono">{inv.number}</SheetTitle>
            <InvoiceStatusBadge status={eff} kind={inv.kind} />
          </div>
          <SheetDescription>{customer ? 'Customer invoice' : 'Supplier invoice'} · {inv.partyName}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <div className="rounded-lg border border-border bg-surface-2/50 p-4">
            <div className="grid grid-cols-3 gap-3">
              <div><div className="label-xs">Invoice total</div><div className="num text-xl font-semibold tracking-tight">{money(inv.amountUsd, { digits: 2 })}</div></div>
              <div><div className="label-xs">{customer ? 'Received' : 'Paid'}</div><div className="num text-xl font-semibold tracking-tight text-success">{money(inv.paidUsd, { digits: 2 })}</div></div>
              <div><div className="label-xs">Balance</div><div className={`num text-xl font-semibold tracking-tight ${dpd > 0 ? 'text-danger' : ''}`}>{money(balance, { digits: 2 })}</div></div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${paidPct}%` }} /></div>
            {dpd > 0 && <p className="mt-2 text-xs font-medium text-danger">{dpd} day{dpd === 1 ? '' : 's'} overdue — due {fmtDate(inv.dueDate)}</p>}
          </div>
          <DetailGrid
            items={[
              { label: customer ? 'Customer' : 'Supplier', value: customer ? <CustomerLink id={inv.partyId} /> : inv.partyName },
              { label: 'Branch', value: <BranchLink id={inv.branchId} /> },
              { label: 'Issued', value: fmtDate(inv.issueDate) },
              { label: 'Due', value: <DueDate inv={inv} now={now} /> },
              { label: 'Terms', value: `Net ${Math.round((new Date(inv.dueDate).getTime() - new Date(inv.issueDate).getTime()) / 864e5)} days` },
              { label: 'Last payment ref', value: inv.paymentRef ?? '—' },
            ]}
          />
          <p className="text-[13px] text-muted-foreground">{inv.description}</p>

          {customer && (
            <Panel title={`Billed trips (${trips.length})`} flush>
              {trips.length === 0 ? (
                <EmptyState compact title="No linked trips" />
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[13px]">
                    <tbody>
                      {trips.map((t) => (
                        <tr key={t.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-1.5"><TripLink id={t.id} /></td>
                          <td className="px-2 py-1.5 text-muted-foreground">{t.origin.city} → {t.destination.city}</td>
                          <td className="num hidden px-2 py-1.5 text-xs text-subtle-foreground sm:table-cell">{fmtDate(t.actualEnd)}</td>
                          <td className="num px-3 py-1.5 text-right font-medium">{money(t.revenueUsd, { digits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          <Panel title={`Payment history (${inv.payments.length})`} flush>
            {inv.payments.length === 0 ? (
              <EmptyState compact title="No payments recorded" description={inv.status === 'draft' ? 'Send the invoice before recording payments.' : 'Record a payment when funds are received.'} />
            ) : (
              <ul className="divide-y divide-border">
                {inv.payments.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]">
                    <div className="min-w-0">
                      <div className="font-medium">{p.method}</div>
                      <div className="text-xs text-subtle-foreground">{fmtDate(p.date)} · {p.ref}</div>
                    </div>
                    <span className="num font-semibold text-success">{money(p.amountUsd, { digits: 2 })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="text-[11px] text-subtle-foreground">{fmtNumber(inv.payments.length)} payment(s) on record · stored status “{inv.status}”.</p>
        </SheetBody>
        <SheetFooter>
          {canDelete && inv.status === 'draft' && inv.paidUsd === 0 && <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => void actions.remove([inv]).then((n) => n && onClose())}><Trash2 /> Delete</Button>}
          {canExport && customer && trips.length > 0 && <Button variant="outline" onClick={exportCsv}><Download /> Lines CSV</Button>}
          {inv.status === 'draft' && (customer ? canEdit : canApprove) && <Button variant={balance > 0 ? 'outline' : 'default'} onClick={() => void actions.release([inv])}>{customer ? <Send /> : <Check />} {customer ? 'Send to customer' : 'Approve for payment'}</Button>}
          {canEdit && inv.status !== 'draft' && balance > 0 && <Button onClick={() => setPaying(inv)}><Banknote /> {customer ? 'Record receipt' : 'Record payment'}</Button>}
        </SheetFooter>
        <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
      </SheetContent>
    </Sheet>
  )
}

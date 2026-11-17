import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Building2, CircleDollarSign, Eye, PackagePlus, Pause, Pencil, Play, Plus, Trash2, Truck, Users, WalletCards } from 'lucide-react'
import type { Customer } from '@/types'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { DataTable, actionsColumn, type BulkAction } from '@/components/data-table/DataTable'
import { KpiCard } from '@/components/shared/KpiCard'
import { Page, PageHeader } from '@/components/shared/Page'
import { cn } from '@/lib/utils'
import { fmtNumber } from '@/lib/format'
import { CustomerFormDialog } from './CustomerFormDialog'
import { useCustomerStats, type CustomerStats } from './customerStats'
import { CUSTOMER_STATUS, customerDependencies, deleteCustomer, toggleHold } from './customerActions'
import { toast } from 'sonner'
import { confirm } from '@/store/confirm'

interface Row extends Customer, CustomerStats {
  statusLabel: string
}

export default function CustomersPage() {
  const nav = useNavigate()
  const money = useMoney()
  const canCreate = useCan('shipments.create')
  const canEdit = useCan('shipments.edit')
  const canDelete = useCan('shipments.delete')
  const canExport = useCan('shipments.export')
  const customers = useDb((s) => s.customers)
  const stats = useCustomerStats()
  const [params, setParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | undefined>()

  useEffect(() => {
    if (!params.get('new')) return
    if (canCreate) {
      setEditing(undefined)
      setFormOpen(true)
    }
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo<Row[]>(
    () => customers.map((c) => ({ ...c, ...stats.get(c.id)!, statusLabel: CUSTOMER_STATUS[c.status].label })),
    [customers, stats],
  )

  const kpi = useMemo(() => {
    let outstanding = 0, overdue = 0, over = 0, rev = 0, active = 0
    for (const r of rows) {
      outstanding += r.outstanding
      overdue += r.overdue
      rev += r.revenue90
      active += r.activeShipments
      if (r.outstanding > r.creditLimitUsd) over++
    }
    return { outstanding, overdue, over, rev, active, activeCust: rows.filter((r) => r.status === 'active').length, held: rows.filter((r) => r.status !== 'active').length }
  }, [rows])

  const openEdit = (c: Customer) => { setEditing(c); setFormOpen(true) }

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      {
        accessorKey: 'name', header: 'Customer', size: 260, meta: { label: 'Customer' },
        cell: ({ row }) => (
          <Link to={`/customers/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="group flex min-w-0 items-center gap-2.5">
            <Avatar name={row.original.name} size={28} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-medium group-hover:text-primary group-hover:underline">{row.original.name}</span>
              <span className="block font-mono text-[11px] text-muted-foreground">{row.original.code}</span>
            </span>
          </Link>
        ),
      },
      { accessorKey: 'industry', header: 'Industry', size: 140, filterFn: 'inArray', meta: { label: 'Industry' } },
      { accessorKey: 'city', header: 'City', size: 100, filterFn: 'inArray', meta: { label: 'City' } },
      {
        accessorKey: 'contactName', header: 'Contact', size: 210, meta: { label: 'Contact' },
        cell: ({ row }) => (
          <div className="min-w-0 leading-tight">
            <p className="truncate">{row.original.contactName}</p>
            <a href={`mailto:${row.original.email}`} onClick={(e) => e.stopPropagation()} className="block truncate text-xs text-muted-foreground hover:text-primary hover:underline">{row.original.email}</a>
          </div>
        ),
      },
      { accessorKey: 'phone', header: 'Phone', size: 130, meta: { label: 'Phone' } },
      { accessorKey: 'paymentTermsDays', header: 'Terms', size: 80, meta: { label: 'Payment terms', align: 'right' }, cell: ({ row }) => `${row.original.paymentTermsDays} days` },
      { accessorKey: 'creditLimitUsd', header: 'Credit limit', size: 105, meta: { label: 'Credit limit', align: 'right', exportValue: (r) => r.creditLimitUsd }, cell: ({ row }) => money(row.original.creditLimitUsd) },
      {
        accessorKey: 'outstanding', header: 'Outstanding', size: 115, meta: { label: 'Outstanding', align: 'right', exportValue: (r) => Math.round(r.outstanding) },
        cell: ({ row }) => <span className={cn(row.original.outstanding > row.original.creditLimitUsd && 'font-medium text-danger')}>{money(row.original.outstanding)}</span>,
      },
      {
        accessorKey: 'utilisationPct', header: 'Credit used', size: 120, meta: { label: 'Credit used', exportValue: (r) => Math.round(r.utilisationPct) },
        cell: ({ row }) => {
          const p = row.original.utilisationPct
          return (
            <div className="flex items-center gap-2" title={`${p.toFixed(0)}% of credit limit`}>
              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', p > 100 ? 'bg-danger' : p > 75 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, p)}%` }} /></div>
              <span className={cn('num text-xs', p > 100 ? 'text-danger' : 'text-muted-foreground')}>{p.toFixed(0)}%</span>
            </div>
          )
        },
      },
      {
        accessorKey: 'shipments', header: 'Shipments', size: 100, meta: { label: 'Shipments', align: 'right' },
        cell: ({ row }) => <Link to={`/shipments?customer=${row.original.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary hover:underline">{fmtNumber(row.original.shipments)}{row.original.activeShipments > 0 && <span className="ml-1 text-xs text-info">({row.original.activeShipments} open)</span>}</Link>,
      },
      { accessorKey: 'revenue90', header: 'Revenue (90d)', size: 120, meta: { label: 'Revenue (90d)', align: 'right', exportValue: (r) => Math.round(r.revenue90) }, cell: ({ row }) => money(row.original.revenue90) },
      { accessorKey: 'statusLabel', header: 'Status', size: 100, filterFn: 'inArray', meta: { label: 'Status' }, cell: ({ row }) => <Badge tone={CUSTOMER_STATUS[row.original.status].tone}>{row.original.statusLabel}</Badge> },
      actionsColumn<Row>((r) => [
        { label: 'View customer', icon: <Eye />, onClick: () => nav(`/customers/${r.id}`) },
        { label: 'New shipment', icon: <PackagePlus />, onClick: () => nav(`/shipments?new=1&customer=${r.id}`), hidden: !canCreate || r.status !== 'active' },
        { label: 'Edit', icon: <Pencil />, onClick: () => openEdit(r), hidden: !canEdit, separatorBefore: true },
        { label: r.status === 'active' ? 'Place on hold' : 'Reactivate', icon: r.status === 'active' ? <Pause /> : <Play />, onClick: () => void toggleHold(r), hidden: !canEdit },
        { label: 'Delete', icon: <Trash2 />, onClick: () => void deleteCustomer(r), hidden: !canDelete, destructive: true, separatorBefore: true },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, nav, canCreate, canEdit, canDelete],
  )

  const bulk = useMemo<BulkAction<Row>[]>(() => {
    const list: BulkAction<Row>[] = []
    if (canEdit) {
      list.push({
        label: 'Place on hold', icon: <Pause />,
        onClick: async (sel, clear) => {
          const targets = sel.filter((r) => r.status === 'active')
          if (!targets.length) return void toast.info('All selected customers are already on hold or inactive')
          if (!(await confirm({ title: `Place ${targets.length} customer${targets.length === 1 ? '' : 's'} on hold?`, description: 'New shipments cannot be registered for them until the hold is released.', confirmLabel: 'Place on hold', destructive: true }))) return
          useDb.getState().updateMany('customers', targets.map((t) => t.id), { status: 'on_hold' }, { action: 'status', summary: `Placed ${targets.length} customers on hold` })
          toast.success(`${targets.length} customer${targets.length === 1 ? '' : 's'} placed on hold`)
          clear()
        },
      })
      list.push({
        label: 'Reactivate', icon: <Play />,
        onClick: (sel, clear) => {
          const targets = sel.filter((r) => r.status !== 'active')
          if (!targets.length) return void toast.info('All selected customers are already active')
          useDb.getState().updateMany('customers', targets.map((t) => t.id), { status: 'active' }, { action: 'status', summary: `Reactivated ${targets.length} customers` })
          toast.success(`${targets.length} customer${targets.length === 1 ? '' : 's'} reactivated`)
          clear()
        },
      })
    }
    if (canDelete) {
      list.push({
        label: 'Delete', icon: <Trash2 />, destructive: true,
        onClick: async (sel, clear) => {
          const deletable = sel.filter((r) => { const d = customerDependencies(r); return !d.shipments && !d.trips && !d.invoices })
          if (!deletable.length) return void toast.error('None of the selected customers can be deleted', { description: 'Customers with shipments, trips or invoices must be set to Inactive instead.' })
          if (!(await confirm({ title: `Delete ${deletable.length} customer${deletable.length === 1 ? '' : 's'}?`, description: deletable.length < sel.length ? `${sel.length - deletable.length} selected customers have history and will be skipped.` : 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return
          useDb.getState().removeMany('customers', deletable.map((d) => d.id))
          toast.success(`${deletable.length} customer${deletable.length === 1 ? '' : 's'} deleted`)
          clear()
        },
      })
    }
    return list
  }, [canEdit, canDelete])

  const facets = useMemo(
    () => [
      { columnId: 'statusLabel', label: 'Status', options: Object.values(CUSTOMER_STATUS).map((s) => ({ value: s.label, label: s.label })) },
      { columnId: 'industry', label: 'Industry', options: [...new Set(customers.map((c) => c.industry))].sort().map((v) => ({ value: v, label: v })) },
      { columnId: 'city', label: 'City', options: [...new Set(customers.map((c) => c.city))].sort().map((v) => ({ value: v, label: v })) },
    ],
    [customers],
  )

  return (
    <Page>
      <PageHeader
        title="Customers"
        description="Customer accounts, credit exposure and delivery performance across the network."
        actions={canCreate && <Button onClick={() => { setEditing(undefined); setFormOpen(true) }}><Plus /> Add customer</Button>}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Customers" value={rows.length} icon={Building2} hint={`${kpi.activeCust} active accounts`} />
        <KpiCard label="On hold / inactive" value={kpi.held} icon={Ban} status={kpi.held ? 'warning' : undefined} />
        <KpiCard label="Outstanding" value={money(kpi.outstanding, { compact: true })} icon={WalletCards} hint="Unpaid customer invoices" />
        <KpiCard label="Overdue" value={money(kpi.overdue, { compact: true })} icon={CircleDollarSign} status={kpi.overdue > 0 ? 'danger' : undefined} hint="Past due date" />
        <KpiCard label="Over credit limit" value={kpi.over} icon={Users} status={kpi.over ? 'danger' : 'success'} />
        <KpiCard label="Open shipments" value={kpi.active} icon={Truck} href="/shipments" hint="Not yet delivered" />
      </div>
      <DataTable<Row>
        data={rows}
        columns={columns}
        tableId="customers"
        getRowId={(r) => r.id}
        exportName={canExport ? 'customers' : undefined}
        searchPlaceholder="Search customers, contacts, cities…"
        facets={facets}
        selectable
        bulkActions={bulk}
        defaultSort={[{ id: 'name', desc: false }]}
        defaultHidden={['phone', 'revenue90']}
        onRowClick={(r) => nav(`/customers/${r.id}`)}
        emptyTitle="No customers found"
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={r.name} size={32} />
                <div className="min-w-0 leading-tight">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.industry} · {r.city}</p>
                </div>
              </div>
              <Badge tone={CUSTOMER_STATUS[r.status].tone}>{r.statusLabel}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><p className="text-subtle-foreground">Outstanding</p><p className={cn('num font-medium', r.outstanding > r.creditLimitUsd && 'text-danger')}>{money(r.outstanding)}</p></div>
              <div><p className="text-subtle-foreground">Credit limit</p><p className="num font-medium">{money(r.creditLimitUsd)}</p></div>
              <div><p className="text-subtle-foreground">Shipments</p><p className="num font-medium">{r.shipments}</p></div>
            </div>
          </div>
        )}
      />
      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editing} />
    </Page>
  )
}

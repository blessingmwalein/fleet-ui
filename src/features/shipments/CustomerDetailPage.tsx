import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowLeft, Ban, CheckCircle2, CircleDollarSign, Mail, MoreHorizontal, PackagePlus, Pause, Pencil, Phone, Play, Trash2, Truck, UserX, Gauge, Package } from 'lucide-react'
import type { Customer, Invoice, Shipment, Trip } from '@/types'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { DataTable } from '@/components/data-table/DataTable'
import { MiniMap, type MiniMapMarker } from '@/components/map/MiniMap'
import { ChartCard, TimeSeriesChart } from '@/components/charts/charts'
import { DetailGrid, Page, Panel, Timeline, type TimelineItem } from '@/components/shared/Page'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { Status } from '@/components/shared/Status'
import { DriverLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { INVOICE_STATUS } from '@/config/status'
import { cn } from '@/lib/utils'
import { fmtDate, fmtDateTime, fmtKm, fmtNumber, timeAgo } from '@/lib/format'
import { CustomerFormDialog } from './CustomerFormDialog'
import { useCustomerStats } from './customerStats'
import { CUSTOMER_STATUS, deleteCustomer, toggleHold } from './customerActions'
import { useShipmentActions } from './useShipmentActions'
import { cargoLabel, fmtWeight, invoiceBalance } from './shipmentLib'

export default function CustomerDetailPage() {
  const { id } = useParams()
  const customer = useDb((s) => s.customers.find((c) => c.id === id))
  if (!customer)
    return (
      <Page>
        <div className="panel">
          <EmptyState icon={UserX} title="Customer not found" description="The account may have been deleted or the link is incorrect." action={<Button asChild size="sm"><Link to="/customers">Back to customers</Link></Button>} />
        </div>
      </Page>
    )
  return <Detail c={customer} />
}

function Detail({ c }: { c: Customer }) {
  const nav = useNavigate()
  const money = useMoney()
  const canCreate = useCan('shipments.create')
  const canEdit = useCan('shipments.edit')
  const canDelete = useCan('shipments.delete')
  const stats = useCustomerStats().get(c.id)!
  const actions = useShipmentActions()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'shipments'
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); if (t === 'shipments') n.delete('tab'); else n.set('tab', t); return n }, { replace: true })
  const [editOpen, setEditOpen] = useState(false)

  const allShipments = useDb((s) => s.shipments)
  const allTrips = useDb((s) => s.trips)
  const allInvoices = useDb((s) => s.invoices)
  const auditLog = useDb((s) => s.auditLog)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)

  const shipments = useMemo(() => allShipments.filter((s) => s.customerId === c.id), [allShipments, c.id])
  const trips = useMemo(() => allTrips.filter((t) => t.customerId === c.id), [allTrips, c.id])
  const invoices = useMemo(() => allInvoices.filter((i) => i.kind === 'customer' && i.partyId === c.id), [allInvoices, c.id])

  const markers = useMemo<MiniMapMarker[]>(() => [{ id: c.id, lat: c.lat, lng: c.lng, kind: 'customer', label: c.city }], [c.id, c.lat, c.lng, c.city])
  const status = CUSTOMER_STATUS[c.status]

  // revenue by month (last 6 months) from completed trips
  const monthly = useMemo(() => {
    const now = new Date()
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en-US', { month: 'short' }), title: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }), revenue: 0, trips: 0 }
    })
    for (const t of trips) {
      if (t.status !== 'completed' || !t.actualEnd) continue
      const d = new Date(t.actualEnd)
      const b = buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`)
      if (b) {
        b.revenue += t.revenueUsd
        b.trips++
      }
    }
    return buckets
  }, [trips])

  const shipmentRows = useMemo(() => shipments.map((s) => ({ ...s, routeText: `${s.pickup.city} → ${s.delivery.city}`, etaIso: s.deliveredAt ?? s.deliveryEta, vehicleReg: vehicles.find((v) => v.id === s.vehicleId)?.reg ?? '' })), [shipments, vehicles])
  const tripRows = useMemo(
    () => trips.map((t) => ({ ...t, routeText: `${t.origin.city} → ${t.destination.city}`, vehicleReg: vehicles.find((v) => v.id === t.vehicleId)?.reg ?? '', driverName: drivers.find((d) => d.id === t.driverId)?.name ?? '', km: t.actualDistanceKm ?? t.plannedDistanceKm })),
    [trips, vehicles, drivers],
  )
  const invoiceRows = useMemo(() => invoices.map((i) => ({ ...i, balance: invoiceBalance(i) })), [invoices])

  // Activity feed: audit entries + business events derived from shipments / invoices
  const activity = useMemo(() => {
    const ids = new Set([c.id, ...shipments.map((s) => s.id), ...invoices.map((i) => i.id)])
    const items: { id: string; ts: number; item: TimelineItem }[] = []
    const add = (id: string, at: string | null | undefined, title: string, description?: string, tone?: TimelineItem['tone']) => {
      if (!at) return
      items.push({ id, ts: new Date(at).getTime(), item: { id, title, description, time: fmtDateTime(at), tone } })
    }
    for (const a of auditLog) if (ids.has(a.entityId)) add(a.id, a.at, a.summary, a.userName)
    for (const s of shipments) {
      add(`reg-${s.id}`, s.createdAt, `Shipment ${s.trackingRef} registered`, `${s.pickup.city} → ${s.delivery.city} · ${s.cargoDescription}`)
      if (s.deliveredAt) add(`del-${s.id}`, s.deliveredAt, `Shipment ${s.trackingRef} delivered`, s.pod ? `POD signed by ${s.pod.receivedBy}` : undefined)
      if (s.exception) add(`exc-${s.id}`, s.exception.raisedAt, `Exception on ${s.trackingRef}: ${s.exception.type}`, s.exception.resolved ? 'Resolved' : 'Open', s.exception.resolved ? 'warning' : 'danger')
    }
    for (const i of invoices) {
      if (i.status !== 'draft') add(`inv-${i.id}`, i.issueDate, `Invoice ${i.number} issued`, `${money(i.amountUsd)} · due ${fmtDate(i.dueDate)}`)
      for (const [k, p] of i.payments.entries()) add(`pay-${i.id}-${k}`, p.date, `Payment received on ${i.number}`, `${money(p.amountUsd)} via ${p.method} · ${p.ref}`)
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 40)
  }, [auditLog, shipments, invoices, c.id, money])

  const shipmentCols = useMemo<ColumnDef<(typeof shipmentRows)[number], any>[]>(
    () => [
      { accessorKey: 'trackingRef', header: 'Tracking ref', size: 130, cell: ({ row }) => <Link to={`/shipments/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] font-medium hover:text-primary hover:underline">{row.original.trackingRef}</Link> },
      { accessorKey: 'cargoDescription', header: 'Cargo', size: 220, cell: ({ row }) => <div className="min-w-0 leading-tight"><p className="truncate">{row.original.cargoDescription}</p><p className="truncate text-xs text-muted-foreground">{cargoLabel(row.original.cargoType)} · {fmtWeight(row.original.weightKg)}</p></div> },
      { accessorKey: 'routeText', header: 'Route', size: 190 },
      { accessorKey: 'vehicleReg', header: 'Vehicle', size: 100, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { accessorKey: 'status', header: 'Status', size: 130, cell: ({ row }) => <Status kind="shipment" value={row.original.status} /> },
      { accessorKey: 'etaIso', header: 'ETA / delivered', size: 150, cell: ({ row }) => <span className="num">{fmtDateTime(row.original.etaIso)}</span>, meta: { exportValue: (r) => r.etaIso } },
      { accessorKey: 'chargeUsd', header: 'Charge', size: 90, meta: { align: 'right', exportValue: (r) => r.chargeUsd }, cell: ({ row }) => money(row.original.chargeUsd) },
    ],
    [money],
  )
  const tripCols = useMemo<ColumnDef<(typeof tripRows)[number], any>[]>(
    () => [
      { accessorKey: 'ref', header: 'Trip', size: 130, cell: ({ row }) => <TripLink id={row.original.id} /> },
      { accessorKey: 'routeText', header: 'Route', size: 190 },
      { accessorKey: 'vehicleReg', header: 'Vehicle', size: 100, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { accessorKey: 'driverName', header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} /> },
      { accessorKey: 'status', header: 'Status', size: 130, cell: ({ row }) => <Status kind="trip" value={row.original.status} /> },
      { accessorKey: 'scheduledStart', header: 'Departure', size: 150, cell: ({ row }) => <span className="num">{fmtDateTime(row.original.scheduledStart)}</span> },
      { accessorKey: 'km', header: 'Distance', size: 90, meta: { align: 'right', exportValue: (r) => r.km }, cell: ({ row }) => fmtKm(row.original.km) },
      { accessorKey: 'delayMinutes', header: 'Delay (min)', size: 90, meta: { align: 'right' }, cell: ({ row }) => (row.original.delayMinutes ? <span className="text-danger">{row.original.delayMinutes}</span> : '—') },
      { accessorKey: 'revenueUsd', header: 'Revenue', size: 90, meta: { align: 'right', exportValue: (r) => r.revenueUsd }, cell: ({ row }) => money(row.original.revenueUsd) },
    ],
    [money],
  )
  const invoiceCols = useMemo<ColumnDef<(typeof invoiceRows)[number], any>[]>(
    () => [
      { accessorKey: 'number', header: 'Invoice', size: 130, cell: ({ row }) => <Link to={`/finance/invoices?open=${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] font-medium hover:text-primary hover:underline">{row.original.number}</Link> },
      { accessorKey: 'description', header: 'Description', size: 240 },
      { accessorKey: 'issueDate', header: 'Issued', size: 110, cell: ({ row }) => <span className="num">{fmtDate(row.original.issueDate)}</span> },
      { accessorKey: 'dueDate', header: 'Due', size: 110, cell: ({ row }) => <span className={cn('num', row.original.status === 'overdue' && 'text-danger')}>{fmtDate(row.original.dueDate)}</span> },
      { accessorKey: 'amountUsd', header: 'Amount', size: 100, meta: { align: 'right', exportValue: (r) => r.amountUsd }, cell: ({ row }) => money(row.original.amountUsd) },
      { accessorKey: 'paidUsd', header: 'Paid', size: 100, meta: { align: 'right', exportValue: (r) => r.paidUsd }, cell: ({ row }) => money(row.original.paidUsd) },
      { accessorKey: 'balance', header: 'Balance', size: 100, meta: { align: 'right', exportValue: (r) => r.balance }, cell: ({ row }) => <span className={cn(row.original.balance > 0 && 'font-medium')}>{money(row.original.balance)}</span> },
      { accessorKey: 'status', header: 'Status', size: 120, cell: ({ row }) => <Status kind="invoice" value={row.original.status} /> },
    ],
    [money],
  )

  const delta = stats.revenuePrev90 > 0 ? { pct: pctChange(stats.revenue90, stats.revenuePrev90), label: 'vs previous 90 days' } : undefined
  const utilTone = stats.utilisationPct > 100 ? 'danger' : stats.utilisationPct > 75 ? 'warning' : 'success'

  return (
    <Page>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Button asChild variant="ghost" size="icon" className="-ml-1 shrink-0" aria-label="Back to customers"><Link to="/customers"><ArrowLeft /></Link></Button>
          <Avatar name={c.name} size={40} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold leading-tight tracking-tight">{c.name}</h1>
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{c.code}</span>
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{c.industry} · {c.city} · customer since {fmtDate(c.createdAt, 'MMM yyyy')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && c.status === 'active' && <Button onClick={() => actions.register(c.id)}><PackagePlus /> New shipment</Button>}
          {canEdit && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>}
          {canEdit && c.status !== 'inactive' && (
            <Button variant="outline" onClick={() => void toggleHold(c)}>{c.status === 'active' ? <><Pause /> Place on hold</> : <><Play /> Release hold</>}</Button>
          )}
          {(canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => nav(`/shipments?customer=${c.id}`)}><Truck /> All shipments in list</DropdownMenuItem>
                {canEdit && c.status !== 'inactive' && <DropdownMenuItem onSelect={() => { useDb.getState().update('customers', c.id, { status: 'inactive' }, { action: 'status', summary: `Deactivated customer ${c.name}` }) }}><Ban /> Mark inactive</DropdownMenuItem>}
                {canEdit && c.status === 'inactive' && <DropdownMenuItem onSelect={() => { useDb.getState().update('customers', c.id, { status: 'active' }, { action: 'status', summary: `Reactivated customer ${c.name}` }) }}><CheckCircle2 /> Reactivate</DropdownMenuItem>}
                {canDelete && <><DropdownMenuSeparator /><DropdownMenuItem destructive onSelect={() => void deleteCustomer(c).then((ok) => ok && nav('/customers', { replace: true }))}><Trash2 /> Delete customer</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-3">
        <Panel title="Profile" className="lg:row-span-1">
          <div className="space-y-4">
            <DetailGrid
              columns={2}
              items={[
                { label: 'Primary contact', value: c.contactName },
                { label: 'Phone', value: <a href={`tel:${c.phone}`} className="hover:text-primary hover:underline">{c.phone}</a> },
                { label: 'Email', value: <a href={`mailto:${c.email}`} className="hover:text-primary hover:underline" title={c.email}>{c.email}</a> },
                { label: 'Payment terms', value: `${c.paymentTermsDays} days` },
                { label: 'Address', value: <span title={c.address}>{c.address}</span> },
                { label: 'Credit limit', value: <span className="num">{money(c.creditLimitUsd)}</span> },
              ]}
            />
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">Credit used</span>
                <span className={cn('num font-medium', utilTone === 'danger' && 'text-danger', utilTone === 'warning' && 'text-warning')}>{money(stats.outstanding)} of {money(c.creditLimitUsd)} · {stats.utilisationPct.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full transition-[width] duration-700', utilTone === 'danger' ? 'bg-danger' : utilTone === 'warning' ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, stats.utilisationPct)}%` }} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline"><a href={`tel:${c.phone}`}><Phone /> Call</a></Button>
              <Button asChild size="sm" variant="outline"><a href={`mailto:${c.email}`}><Mail /> Email</a></Button>
            </div>
            <MiniMap height={150} markers={markers} center={{ lat: c.lat, lng: c.lng }} zoom={11} interactive={false} />
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard label="Revenue (90d)" value={stats.revenue90} format={(n) => money(n, { compact: true })} delta={delta} icon={CircleDollarSign} hint={`${money(stats.revenuePrev90)} in the previous 90 days`} />
            <KpiCard label="Outstanding" value={stats.outstanding} format={(n) => money(n, { compact: true })} icon={CircleDollarSign} status={stats.overdue > 0 ? 'danger' : undefined} hint={`${stats.openInvoices} open invoice${stats.openInvoices === 1 ? '' : 's'} · ${money(stats.overdue)} overdue`} />
            <KpiCard label="On-time delivery" value={stats.onTimePct === null ? '—' : `${stats.onTimePct.toFixed(0)}%`} icon={Gauge} status={stats.onTimePct === null ? undefined : stats.onTimePct >= 85 ? 'success' : stats.onTimePct >= 70 ? 'warning' : 'danger'} hint="Completed trips in the last 180 days within 20 min of plan" />
            <KpiCard label="Shipments" value={stats.shipments} icon={Package} hint={`${stats.activeShipments} open · ${stats.delivered} delivered${stats.exceptions ? ` · ${stats.exceptions} with open exception` : ''}`} />
          </div>
          <ChartCard title="Revenue & trips by month" description="Completed trips, last 6 months" className="flex-1">
            <TimeSeriesChart
              data={monthly}
              titleKey="title"
              height={190}
              yFormat={(v) => money(v, { compact: true })}
              y2Format={(v) => String(v)}
              series={[
                { key: 'revenue', label: 'Revenue', type: 'bar', format: (v) => money(v) },
                { key: 'trips', label: 'Trips', type: 'line', axis: 'right', color: 'var(--chart-2)', format: (v) => fmtNumber(v) },
              ]}
            />
          </ChartCard>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="shipments">Shipments <Count n={shipments.length} /></TabsTrigger>
          <TabsTrigger value="trips">Trips <Count n={trips.length} /></TabsTrigger>
          <TabsTrigger value="invoices">Invoices <Count n={invoices.length} /></TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="shipments">
          <DataTable
            data={shipmentRows}
            columns={shipmentCols}
            tableId="customer-shipments"
            getRowId={(r) => r.id}
            exportName={`${c.code}-shipments`}
            defaultSort={[{ id: 'etaIso', desc: true }]}
            onRowClick={(r: Shipment) => nav(`/shipments/${r.id}`)}
            searchPlaceholder="Search this customer's shipments…"
            defaultPageSize={10}
            emptyTitle="No shipments yet"
            emptyDescription="Register a shipment for this customer to see it here."
            actions={canCreate && c.status === 'active' ? <Button size="sm" onClick={() => actions.register(c.id)}><PackagePlus /> New shipment</Button> : undefined}
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[12.5px] font-semibold">{r.trackingRef}</span><Status kind="shipment" value={r.status} /></div>
                <p className="truncate text-[13px]">{r.routeText}</p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(r.etaIso)} · {money(r.chargeUsd)}</p>
              </div>
            )}
          />
        </TabsContent>
        <TabsContent value="trips">
          <DataTable
            data={tripRows}
            columns={tripCols}
            tableId="customer-trips"
            getRowId={(r) => r.id}
            exportName={`${c.code}-trips`}
            defaultSort={[{ id: 'scheduledStart', desc: true }]}
            onRowClick={(r: Trip) => useUi.getState().openTrip(r.id)}
            searchPlaceholder="Search this customer's trips…"
            defaultPageSize={10}
            emptyTitle="No trips yet"
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[12.5px] font-semibold">{r.ref}</span><Status kind="trip" value={r.status} /></div>
                <p className="truncate text-[13px]">{r.routeText}</p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(r.scheduledStart)} · {fmtKm(r.km)} · {money(r.revenueUsd)}</p>
              </div>
            )}
          />
        </TabsContent>
        <TabsContent value="invoices">
          <DataTable
            data={invoiceRows}
            columns={invoiceCols}
            tableId="customer-invoices"
            getRowId={(r) => r.id}
            exportName={`${c.code}-invoices`}
            defaultSort={[{ id: 'issueDate', desc: true }]}
            onRowClick={(r: Invoice) => nav(`/finance/invoices?open=${r.id}`)}
            searchPlaceholder="Search invoices…"
            defaultPageSize={10}
            emptyTitle="No invoices yet"
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[12.5px] font-semibold">{r.number}</span><Badge tone={INVOICE_STATUS[r.status].tone}>{INVOICE_STATUS[r.status].label}</Badge></div>
                <p className="text-xs text-muted-foreground">Issued {fmtDate(r.issueDate)} · due {fmtDate(r.dueDate)}</p>
                <p className="num text-[13px]">{money(r.amountUsd)} <span className="text-xs text-muted-foreground">· balance {money(r.balance)}</span></p>
              </div>
            )}
          />
        </TabsContent>
        <TabsContent value="activity">
          <Panel title="Recent activity" description="Shipments, invoices, payments and account changes">
            {activity.length ? <Timeline items={activity.map((a) => a.item)} /> : <p className="py-6 text-center text-xs text-muted-foreground">No activity recorded yet.</p>}
            {stats.lastShipmentAt && <p className="mt-3 border-t border-border pt-2 text-xs text-subtle-foreground">Last shipment registered {timeAgo(stats.lastShipmentAt)}</p>}
          </Panel>
        </TabsContent>
      </Tabs>
      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={c} />
      {actions.dialogs}
    </Page>
  )
}

function Count({ n }: { n: number }) {
  return <span className="num rounded bg-surface-3 px-1 text-[11px] text-muted-foreground">{n}</span>
}

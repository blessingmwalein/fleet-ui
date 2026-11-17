import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Eye, Pencil, Plus, Trash2, Truck, TriangleAlert, ShieldCheck, Radio } from 'lucide-react'
import type { Shipment, ShipmentStatus } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useBranchScope } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction, type FacetFilter } from '@/components/data-table/DataTable'
import { Page, PageHeader } from '@/components/shared/Page'
import { Status } from '@/components/shared/Status'
import { CustomerLink, DriverLink, VehicleLink } from '@/components/shared/EntityLink'
import { StatusDot } from '@/components/ui/display'
import { SHIPMENT_STATUS, statusMeta } from '@/config/status'
import { cn } from '@/lib/utils'
import { fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { canAllocate, canCapturePod, canRaiseException, canUpdateStatus, cargoLabel, fmtWeight, isOpenException, SHIPMENT_STATUSES } from './shipmentLib'
import { useShipmentActions } from './useShipmentActions'

interface Row extends Shipment {
  customerName: string
  vehicleReg: string
  driverName: string
  routeText: string
  branchName: string
  cargoName: string
  statusLabel: string
  etaIso: string
  liveEtaTs: number | null
  overdue: boolean
  hasException: boolean
}

type Stage = 'all' | ShipmentStatus

export default function ShipmentsPage() {
  const nav = useNavigate()
  const money = useMoney()
  const actions = useShipmentActions()
  const { scope } = useBranchScope()
  const [params, setParams] = useSearchParams()

  const shipments = useDb((s) => s.shipments)
  const customers = useDb((s) => s.customers)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branches = useDb((s) => s.branches)

  const [stage, setStage] = useState<Stage>(() => {
    const p = params.get('status')
    return p && (SHIPMENT_STATUSES as string[]).includes(p) ? (p as ShipmentStatus) : 'all'
  })
  const [excOnly, setExcOnly] = useState(false)
  const [initialFilters] = useState(() => {
    const c = params.get('customer')
    const name = c && !params.get('new') ? useDb.getState().customers.find((x) => x.id === c)?.name : undefined
    return name ? [{ id: 'customerName', value: [name] }] : undefined
  })

  // ?new=1 deep link (optionally with ?customer=<id> preset)
  useEffect(() => {
    if (!params.get('new')) return
    if (actions.can.create) actions.register(params.get('customer') ?? undefined)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('new')
      next.delete('customer')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scoped = useMemo(() => scope(shipments), [scope, shipments])

  // Live ETA (changes every tick) is folded into the row data via a coarse minute-level key so tables don't churn.
  const liveRefs = useMemo(() => scoped.filter((s) => s.tripId && s.vehicleId && (s.status === 'in_transit' || s.status === 'out_for_delivery')).map((s) => [s.vehicleId!, s.tripId!] as const), [scoped])
  const liveKey = useLive((st) => liveRefs.map(([v, t]) => { const tel = st.telemetry[v]; return tel && tel.tripId === t && tel.etaTs ? Math.round(tel.etaTs / 6e4) : 0 }).join(','))

  const rows = useMemo<Row[]>(() => {
    const cm = new Map(customers.map((c) => [c.id, c]))
    const vm = new Map(vehicles.map((v) => [v.id, v]))
    const dm = new Map(drivers.map((d) => [d.id, d]))
    const bm = new Map(branches.map((b) => [b.id, b]))
    const tel = useLive.getState().telemetry
    const now = Date.now()
    return scoped.map((s) => {
      const t = s.vehicleId && s.tripId ? tel[s.vehicleId] : undefined
      const liveEtaTs = t && t.tripId === s.tripId && t.etaTs && (s.status === 'in_transit' || s.status === 'out_for_delivery') ? t.etaTs : null
      const etaIso = s.deliveredAt ?? (liveEtaTs ? new Date(liveEtaTs).toISOString() : s.deliveryEta)
      return {
        ...s,
        customerName: cm.get(s.customerId)?.name ?? '—',
        vehicleReg: (s.vehicleId && vm.get(s.vehicleId)?.reg) || '',
        driverName: (s.driverId && dm.get(s.driverId)?.name) || '',
        routeText: `${s.pickup.city} → ${s.delivery.city}`,
        branchName: bm.get(s.branchId)?.name ?? '—',
        cargoName: cargoLabel(s.cargoType),
        statusLabel: statusMeta('shipment', s.status).label,
        etaIso,
        liveEtaTs,
        overdue: s.status !== 'delivered' && new Date(etaIso).getTime() < now,
        hasException: !!s.exception,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, customers, vehicles, drivers, branches, liveKey])

  const counts = useMemo(() => {
    const c: Record<string, { n: number; usd: number }> = { all: { n: rows.length, usd: rows.reduce((a, r) => a + r.chargeUsd, 0) } }
    for (const k of SHIPMENT_STATUSES) c[k] = { n: 0, usd: 0 }
    for (const r of rows) {
      c[r.status]!.n++
      c[r.status]!.usd += r.chargeUsd
    }
    return c
  }, [rows])

  const data = useMemo(() => rows.filter((r) => (stage === 'all' || r.status === stage) && (!excOnly || r.hasException)), [rows, stage, excOnly])
  const excCount = useMemo(() => rows.filter((r) => r.hasException).length, [rows])

  const facets = useMemo<FacetFilter[]>(
    () => [
      { columnId: 'customerName', label: 'Customer', options: customers.map((c) => c.name).sort().map((n) => ({ value: n, label: n })) },
      { columnId: 'cargoName', label: 'Cargo type', options: [...new Set(rows.map((r) => r.cargoName))].sort().map((n) => ({ value: n, label: n })) },
      { columnId: 'branchName', label: 'Branch', options: branches.filter((b) => b.type !== 'workshop').map((b) => ({ value: b.name, label: b.name })) },
    ],
    [customers, branches, rows],
  )

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      {
        accessorKey: 'trackingRef', header: 'Tracking ref', size: 130, meta: { label: 'Tracking ref' },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <Link to={`/shipments/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] font-medium hover:text-primary hover:underline">{row.original.trackingRef}</Link>
            {row.original.status === 'exception' && (
              <Tooltip content={`${row.original.exception?.type} — open exception`}><AlertTriangle className="size-3.5 text-danger" /></Tooltip>
            )}
            {row.original.hasException && row.original.status !== 'exception' && (
              <Tooltip content={`${row.original.exception?.type} — resolved`}><ShieldCheck className="size-3.5 text-subtle-foreground" /></Tooltip>
            )}
          </span>
        ),
      },
      { accessorKey: 'customerName', header: 'Customer', size: 170, filterFn: 'inArray', meta: { label: 'Customer' }, cell: ({ row }) => <CustomerLink id={row.original.customerId} /> },
      {
        accessorKey: 'cargoDescription', header: 'Cargo', size: 200, meta: { label: 'Cargo' },
        cell: ({ row }) => (
          <div className="min-w-0 leading-tight">
            <p className="truncate">{row.original.cargoDescription}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.cargoName} · {fmtWeight(row.original.weightKg)} · {fmtNumber(row.original.packages)} pkg</p>
          </div>
        ),
      },
      { accessorKey: 'cargoName', header: 'Cargo type', size: 120, filterFn: 'inArray', meta: { label: 'Cargo type' } },
      {
        accessorKey: 'routeText', header: 'Pickup → Delivery', size: 180, meta: { label: 'Route' },
        cell: ({ row }) => (
          <div className="min-w-0 leading-tight">
            <p className="truncate">{row.original.routeText}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.pickup.name}</p>
          </div>
        ),
      },
      {
        accessorKey: 'vehicleReg', header: 'Vehicle / driver', size: 140, meta: { label: 'Vehicle / driver' },
        cell: ({ row }) => (row.original.vehicleId || row.original.driverId ? <div className="min-w-0 leading-tight"><VehicleLink id={row.original.vehicleId} /><DriverLink id={row.original.driverId} className="block text-xs text-muted-foreground" /></div> : <span className="text-subtle-foreground">Unallocated</span>),
      },
      { accessorKey: 'driverName', header: 'Driver', size: 150, meta: { label: 'Driver (search/export)' } },
      { accessorKey: 'statusLabel', header: 'Status', size: 120, meta: { label: 'Status' }, cell: ({ row }) => <Status kind="shipment" value={row.original.status} /> },
      {
        accessorKey: 'etaIso', header: 'ETA / delivered', size: 145, meta: { label: 'ETA / delivered', exportValue: (r) => r.etaIso },
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="leading-tight">
              <p className={cn('num', r.status === 'delivered' && 'text-success')}>{r.status === 'delivered' ? '✓ ' : ''}{fmtDateTime(r.etaIso)}</p>
              {r.status === 'delivered' ? (
                <p className="text-xs text-muted-foreground">{timeAgo(r.deliveredAt)}</p>
              ) : r.overdue ? (
                <p className="text-xs font-medium text-danger">Overdue · {timeAgo(r.etaIso)}</p>
              ) : r.liveEtaTs ? (
                <p className="inline-flex items-center gap-1 text-xs text-success"><Radio className="size-3" /> Live ETA</p>
              ) : (
                <p className="text-xs text-muted-foreground">Planned</p>
              )}
            </div>
          )
        },
      },
      { accessorKey: 'chargeUsd', header: 'Charge', size: 96, meta: { label: 'Charge', align: 'right', exportValue: (r) => r.chargeUsd }, cell: ({ row }) => money(row.original.chargeUsd) },
      { accessorKey: 'branchName', header: 'Branch', size: 130, filterFn: 'inArray', meta: { label: 'Branch' } },
      { accessorKey: 'weightKg', header: 'Weight (kg)', size: 100, meta: { label: 'Weight (kg)', align: 'right' }, cell: ({ row }) => fmtNumber(row.original.weightKg) },
      { accessorKey: 'declaredValueUsd', header: 'Declared value', size: 110, meta: { label: 'Declared value', align: 'right', exportValue: (r) => r.declaredValueUsd }, cell: ({ row }) => money(row.original.declaredValueUsd) },
      { accessorKey: 'createdAt', header: 'Registered', size: 140, meta: { label: 'Registered' }, cell: ({ row }) => <span className="num">{fmtDateTime(row.original.createdAt)}</span> },
      actionsColumn<Row>((r) => [
        { label: 'View details', icon: <Eye />, onClick: () => nav(`/shipments/${r.id}`) },
        { label: 'Allocate vehicle & driver', icon: <Truck />, onClick: () => actions.allocate(r), hidden: !actions.can.edit || !canAllocate(r), separatorBefore: true },
        { label: 'Update status', icon: <ClipboardCheck />, onClick: () => actions.updateStatus(r), hidden: !actions.can.edit || !canUpdateStatus(r) },
        { label: 'Capture proof of delivery', icon: <CheckCircle2 />, onClick: () => actions.capturePod(r), hidden: !actions.can.edit || !canCapturePod(r) },
        { label: 'Raise exception', icon: <TriangleAlert />, onClick: () => actions.raiseException(r), hidden: !actions.can.edit || !canRaiseException(r) },
        { label: 'Resolve exception', icon: <ShieldCheck />, onClick: () => actions.resolveException(r), hidden: !actions.can.edit || !isOpenException(r) },
        { label: 'Edit shipment', icon: <Pencil />, onClick: () => actions.edit(r), hidden: !actions.can.edit, separatorBefore: true },
        { label: 'Delete', icon: <Trash2 />, onClick: () => void actions.remove(r), hidden: !actions.can.delete, destructive: true },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, nav, actions.can.edit, actions.can.delete, actions.allocate, actions.updateStatus, actions.capturePod, actions.raiseException, actions.resolveException, actions.edit, actions.remove],
  )

  const bulkActions = useMemo<BulkAction<Row>[]>(() => {
    const list: BulkAction<Row>[] = []
    if (actions.can.edit) list.push({ label: 'Allocate vehicle', icon: <Truck />, onClick: (r, clear) => actions.bulkAllocate(r, clear) })
    if (actions.can.delete) list.push({ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: (r, clear) => void actions.bulkRemove(r, clear) })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.can.edit, actions.can.delete, actions.bulkAllocate, actions.bulkRemove])

  const strip: { key: Stage; label: string; tone: 'neutral' | 'info' | 'success' | 'primary' | 'danger' }[] = [
    { key: 'all', label: 'All shipments', tone: 'neutral' },
    ...SHIPMENT_STATUSES.map((k) => ({ key: k as Stage, label: SHIPMENT_STATUS[k].label, tone: SHIPMENT_STATUS[k].tone as 'neutral' })),
  ]

  return (
    <Page>
      <PageHeader
        title="Shipments"
        description="Book consignments, allocate vehicles and drivers, and track every shipment from pickup to proof of delivery."
        actions={actions.can.create && <Button onClick={() => actions.register()}><Plus /> Register shipment</Button>}
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" role="group" aria-label="Filter by status">
        {strip.map((s) => {
          const active = stage === s.key
          const c = counts[s.key]!
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStage(active && s.key !== 'all' ? 'all' : s.key)}
              className={cn('panel min-w-0 p-2.5 text-left outline-none transition-colors hover:border-border-strong hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-ring/50', active && 'border-primary/60 bg-primary/8 hover:bg-primary/10')}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {s.key !== 'all' && <StatusDot tone={s.tone} pulse={s.key === 'exception' && c.n > 0} className="size-1.5 [&>span]:size-1.5" />}
                <span className="truncate">{s.label}</span>
              </span>
              <span className="mt-1 flex items-baseline justify-between gap-2">
                <span className="num text-lg font-semibold leading-none">{c.n}</span>
                <span className="num truncate text-[11px] text-subtle-foreground">{money(c.usd, { compact: true })}</span>
              </span>
            </button>
          )
        })}
      </div>

      <DataTable<Row>
        data={data}
        columns={columns}
        tableId="shipments"
        getRowId={(r) => r.id}
        exportName={actions.can.export ? 'shipments' : undefined}
        searchPlaceholder="Search tracking ref, customer, cargo, route…"
        facets={facets}
        initialFilters={initialFilters}
        selectable
        bulkActions={bulkActions}
        defaultSort={[{ id: 'createdAt', desc: true }]}
        defaultHidden={['driverName', 'cargoName', 'branchName', 'weightKg', 'declaredValueUsd', 'createdAt']}
        onRowClick={(r) => nav(`/shipments/${r.id}`)}
        toolbar={
          <Button variant="outline" size="sm" aria-pressed={excOnly} onClick={() => setExcOnly((v) => !v)} className={cn(excOnly && 'border-danger/50 bg-danger/10 text-danger hover:bg-danger/15')}>
            <TriangleAlert /> Exceptions only <span className="num text-subtle-foreground">{excCount}</span>
          </Button>
        }
        emptyTitle="No shipments match"
        emptyDescription="Adjust the status strip, filters or search — or register a new shipment."
        rowClassName={(r) => (r.status === 'exception' ? 'bg-danger/5' : undefined)}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[12.5px] font-semibold">{r.trackingRef}</p>
                <p className="truncate text-xs text-muted-foreground">{r.customerName}</p>
              </div>
              <Status kind="shipment" value={r.status} />
            </div>
            <p className="truncate text-[13px]">{r.routeText}</p>
            <p className="truncate text-xs text-muted-foreground">{r.cargoDescription} · {fmtWeight(r.weightKg)}</p>
            <div className="flex items-center justify-between text-xs">
              <span className={cn('num', r.overdue ? 'text-danger' : 'text-muted-foreground')}>{r.status === 'delivered' ? 'Delivered' : 'ETA'} {fmtDateTime(r.etaIso)}</span>
              <span className="num font-medium">{money(r.chargeUsd)}</span>
            </div>
          </div>
        )}
      />
      {actions.dialogs}
    </Page>
  )
}

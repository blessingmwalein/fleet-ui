import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import { Ban, CheckCircle2, LayoutGrid, List, Plus, Route as RouteIcon, TrendingUp, Truck, UserPlus, Wallet, Trash2 } from 'lucide-react'
import type { Trip, TripStatus } from '@/types'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { useById } from '@/hooks/useLookup'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { DataTable, actionsColumn } from '@/components/data-table/DataTable'
import { Page, PageHeader, Can } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { Status } from '@/components/shared/Status'
import { CustomerLink, DriverLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { CARGO_TYPE, PRIORITY, TRIP_STATUS } from '@/config/status'
import { fmtDateTime, fmtDuration, fmtKm } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BOARD_COLUMNS, isOnTime, isOpen, tripMargin, tripMarginPct } from './tripLogic'
import { openAssign, openCancel, openTripForm, requestDelete } from './tripStore'
import { DelayChip, PriorityBadge, tripActionList, useTripDeepLinks, useTripPerms } from './tripUi'

interface TripRow extends Trip {
  routeText: string
  customerName: string
  vehicleReg: string
  driverName: string
  branchName: string
  margin: number
  marginPct: number
}

export default function TripsPage() {
  useTripDeepLinks()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const perms = useTripPerms()
  const money = useMoney()
  const openTrip = useUi((s) => s.openTrip)
  const range = useDateRange()
  const { scope } = useBranchScope()
  const trips = useDb((s) => s.trips)
  const customers = useDb((s) => s.customers)
  const getVehicle = useById('vehicles')
  const getDriver = useById('drivers')
  const getCustomer = useById('customers')
  const getBranch = useById('branches')
  const [period, setPeriod] = React.useState<'range' | 'all'>('range')

  const rows = React.useMemo<TripRow[]>(
    () =>
      scope(trips)
        .filter((t) => period === 'all' || isOpen(t.status) || range.inRange(t.scheduledStart))
        .map((t) => ({
          ...t,
          routeText: `${t.origin.name} → ${t.destination.name}`,
          customerName: getCustomer(t.customerId)?.name ?? '',
          vehicleReg: getVehicle(t.vehicleId)?.reg ?? '',
          driverName: getDriver(t.driverId)?.name ?? '',
          branchName: getBranch(t.branchId)?.name ?? '',
          margin: tripMargin(t),
          marginPct: tripMarginPct(t),
        })),
    [scope, trips, period, range, getCustomer, getVehicle, getDriver, getBranch],
  )

  const stats = React.useMemo(() => {
    let completed = 0, onTime = 0, active = 0, revenue = 0, cost = 0, km = 0
    for (const t of rows) {
      if (t.status === 'completed') {
        completed++
        if (isOnTime(t)) onTime++
        revenue += t.revenueUsd
        cost += t.expensesUsd
        km += t.actualDistanceKm ?? t.plannedDistanceKm
      } else if (t.status === 'in_transit' || t.status === 'delayed') active++
    }
    return { total: rows.length, completed, onTimePct: completed ? (onTime / completed) * 100 : 0, active, revenue, margin: revenue - cost, marginPct: revenue ? ((revenue - cost) / revenue) * 100 : 0, km }
  }, [rows])

  const initialFilters = React.useMemo<ColumnFiltersState>(() => {
    const s = params.get('status')
    const valid = s ? s.split(',').filter((x) => x in TRIP_STATUS) : []
    return valid.length ? [{ id: 'status', value: valid }] : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const columns = React.useMemo<ColumnDef<TripRow, any>[]>(
    () => [
      { accessorKey: 'ref', header: 'Trip', size: 150, meta: { label: 'Trip ref' }, cell: ({ row }) => <TripLink id={row.original.id} className="num font-medium" /> },
      { accessorKey: 'status', header: 'Status', size: 150, filterFn: 'inArray', meta: { exportValue: (r) => TRIP_STATUS[r.status].label }, cell: ({ row }) => <Status kind="trip" value={row.original.status} pulse={row.original.status === 'in_transit'} /> },
      { accessorKey: 'priority', header: 'Priority', size: 95, filterFn: 'inArray', cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
      { accessorKey: 'routeText', header: 'Route', size: 290, meta: { label: 'Route' }, cell: ({ row }) => <span title={row.original.routeText} className="block truncate">{row.original.routeText}</span> },
      { accessorKey: 'customerName', header: 'Customer', size: 180, filterFn: 'inArray', cell: ({ row }) => (row.original.customerId ? <CustomerLink id={row.original.customerId} /> : <span className="text-subtle-foreground">—</span>) },
      { accessorKey: 'vehicleReg', header: 'Vehicle', size: 105, meta: { label: 'Vehicle' }, cell: ({ row }) => (row.original.vehicleId ? <VehicleLink id={row.original.vehicleId} /> : <span className="text-warning">Unassigned</span>) },
      { accessorKey: 'driverName', header: 'Driver', size: 160, meta: { label: 'Driver' }, cell: ({ row }) => (row.original.driverId ? <DriverLink id={row.original.driverId} avatar /> : <span className="text-warning">Unassigned</span>) },
      { accessorKey: 'scheduledStart', header: 'Scheduled start', size: 150, cell: ({ row }) => <span className="num">{fmtDateTime(row.original.scheduledStart)}</span> },
      { accessorKey: 'plannedDurationMin', header: 'Planned', size: 90, meta: { align: 'right', label: 'Planned duration', exportValue: (r) => r.plannedDurationMin }, cell: ({ row }) => fmtDuration(row.original.plannedDurationMin) },
      {
        accessorFn: (r) => r.actualDurationMin ?? undefined, id: 'actualDurationMin', header: 'Actual', size: 90, meta: { align: 'right', label: 'Actual duration', exportValue: (r) => r.actualDurationMin },
        cell: ({ row }) => (row.original.actualDurationMin === null ? <span className="text-subtle-foreground">—</span> : <span className={cn(row.original.actualDurationMin > row.original.plannedDurationMin * 1.1 && 'text-warning')}>{fmtDuration(row.original.actualDurationMin)}</span>),
      },
      { accessorKey: 'plannedDistanceKm', header: 'Distance', size: 95, meta: { align: 'right', label: 'Planned distance (km)' }, cell: ({ row }) => fmtKm(row.original.plannedDistanceKm, 1) },
      { accessorFn: (r) => r.actualDistanceKm ?? undefined, id: 'actualDistanceKm', header: 'Actual km', size: 95, meta: { align: 'right', label: 'Actual distance (km)', exportValue: (r) => r.actualDistanceKm }, cell: ({ row }) => (row.original.actualDistanceKm === null ? '—' : fmtKm(row.original.actualDistanceKm, 1)) },
      { accessorKey: 'delayMinutes', header: 'Delay', size: 95, meta: { align: 'right', label: 'Delay (min)' }, cell: ({ row }) => (row.original.delayMinutes > 0 ? <DelayChip minutes={row.original.delayMinutes} /> : <span className="text-subtle-foreground">—</span>) },
      { accessorKey: 'expensesUsd', header: 'Expenses', size: 100, meta: { align: 'right', label: 'Expenses (USD)' }, cell: ({ row }) => (row.original.expensesUsd ? money(row.original.expensesUsd) : '—') },
      { accessorKey: 'revenueUsd', header: 'Revenue', size: 100, meta: { align: 'right', label: 'Revenue (USD)' }, cell: ({ row }) => money(row.original.revenueUsd) },
      {
        accessorKey: 'margin', header: 'Margin', size: 125, meta: { align: 'right', label: 'Margin (USD)' },
        cell: ({ row }) => (
          <span className={cn(row.original.margin < 0 ? 'text-danger' : row.original.status === 'completed' && 'text-success')}>
            {money(row.original.margin)} <span className="text-[11px] text-subtle-foreground">{row.original.revenueUsd ? `${row.original.marginPct.toFixed(0)}%` : ''}</span>
          </span>
        ),
      },
      { accessorKey: 'cargoType', header: 'Cargo', size: 130, filterFn: 'inArray', meta: { exportValue: (r) => CARGO_TYPE[r.cargoType] }, cell: ({ row }) => CARGO_TYPE[row.original.cargoType] },
      { accessorKey: 'cargoWeightKg', header: 'Weight', size: 90, meta: { align: 'right', label: 'Cargo weight (kg)' }, cell: ({ row }) => `${(row.original.cargoWeightKg / 1000).toFixed(1)} t` },
      { accessorKey: 'branchName', header: 'Branch', size: 130, meta: { label: 'Branch' } },
      actionsColumn<TripRow>((t) => tripActionList(t, perms).filter((a) => a.key !== 'edit' || true)),
    ],
    [money, perms],
  )

  const customerNames = React.useMemo(() => [...new Set(customers.map((c) => c.name))].sort(), [customers])

  return (
    <Page>
      <PageHeader
        title="Trips"
        description="Every trip across the fleet — filter, export and act in bulk. Open a row for the full detail drawer."
        actions={
          <>
            <Segmented
              aria-label="View"
              size="md"
              value="list"
              onChange={(v) => v === 'board' && navigate('/dispatch')}
              options={[
                { value: 'board', label: <><LayoutGrid className="size-3.5" /> Board</> },
                { value: 'list', label: <><List className="size-3.5" /> List</> },
              ]}
            />
            <Can perm="dispatch.create">
              <Button onClick={() => openTripForm()}><Plus /> New trip</Button>
            </Can>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Trips" value={stats.total} icon={RouteIcon} hint={period === 'range' ? `${range.label} plus all open trips` : 'All time'} />
        <KpiCard label="In transit now" value={stats.active} icon={Truck} status={stats.active ? 'success' : undefined} href="/dispatch" />
        <KpiCard label="Completed" value={stats.completed} icon={CheckCircle2} hint={`${Math.round(stats.km).toLocaleString('en-US')} km delivered`} />
        <KpiCard label="On-time rate" value={`${stats.onTimePct.toFixed(0)}%`} icon={TrendingUp} status={stats.onTimePct >= 85 ? 'success' : 'warning'} hint="Completed within 15 minutes of plan" />
        <KpiCard label="Revenue" value={money(stats.revenue, { compact: true })} icon={Wallet} hint="Completed trips" />
        <KpiCard label="Margin" value={`${stats.marginPct.toFixed(0)}%`} icon={TrendingUp} status={stats.marginPct >= 25 ? 'success' : 'warning'} hint={`${money(stats.margin)} after trip expenses`} />
      </div>

      <DataTable<TripRow>
        tableId="trips"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        exportName="trips"
        searchPlaceholder="Search ref, route, vehicle, driver, customer…"
        defaultSort={[{ id: 'scheduledStart', desc: true }]}
        defaultHidden={['actualDistanceKm', 'plannedDistanceKm', 'cargoType', 'cargoWeightKg', 'branchName']}
        initialFilters={initialFilters}
        selectable
        onRowClick={(r) => openTrip(r.id)}
        rowClassName={(r) => (r.status === 'delayed' ? 'bg-danger/5' : undefined)}
        emptyTitle="No trips match"
        emptyDescription="Adjust the filters, widen the period to All time, or create a new trip."
        facets={[
          { columnId: 'status', label: 'Status', options: BOARD_COLUMNS.map((s: TripStatus) => ({ value: s, label: TRIP_STATUS[s].label })) },
          { columnId: 'priority', label: 'Priority', options: (['urgent', 'high', 'normal', 'low'] as const).map((p) => ({ value: p, label: PRIORITY[p]!.label })) },
          { columnId: 'cargoType', label: 'Cargo', options: Object.entries(CARGO_TYPE).map(([value, label]) => ({ value, label })) },
          { columnId: 'customerName', label: 'Customer', options: customerNames.map((n) => ({ value: n, label: n })) },
        ]}
        toolbar={
          <Segmented
            aria-label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'range', label: range.label },
              { value: 'all', label: 'All time' },
            ]}
          />
        }
        bulkActions={
          perms.edit
            ? [
                { label: 'Assign', icon: <UserPlus />, onClick: (sel, clear) => { openAssign(sel.map((t) => t.id)); clear() } },
                { label: 'Cancel', icon: <Ban />, destructive: true, onClick: (sel, clear) => { openCancel(sel.map((t) => t.id)); clear() } },
                ...(perms.del ? [{ label: 'Delete drafts', icon: <Trash2 />, destructive: true, onClick: (sel: TripRow[], clear: () => void) => { void requestDelete(sel.map((t) => t.id)); clear() } }] : []),
              ]
            : []
        }
        mobileCard={(t) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="num font-semibold">{t.ref}</span>
              <Status kind="trip" value={t.status} />
            </div>
            <p className="truncate text-[13px]">{t.routeText}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t.vehicleReg || 'No vehicle'} · {t.driverName || 'No driver'}</span>
              <span className="num">{fmtDateTime(t.scheduledStart)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <PriorityBadge priority={t.priority} />
              <span className="num text-muted-foreground">{money(t.revenueUsd)} · margin <span className={cn(t.margin < 0 ? 'text-danger' : 'text-foreground')}>{money(t.margin)}</span></span>
            </div>
          </div>
        )}
      />
    </Page>
  )
}

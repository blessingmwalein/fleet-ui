import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { CalendarPlus, Wrench } from 'lucide-react'
import type { FuelTransaction, Trip, Vehicle, WorkOrder, ServiceSchedule } from '@/types'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { useById } from '@/hooks/useLookup'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { KpiCard } from '@/components/shared/KpiCard'
import { Panel } from '@/components/shared/Page'
import { Status } from '@/components/shared/Status'
import { CustomerLink, DriverLink, EntityLink, TripLink } from '@/components/shared/EntityLink'
import { ChartCard, TimeSeriesChart } from '@/components/charts/charts'
import { DataTable } from '@/components/data-table/DataTable'
import { PRIORITY, TRIP_STATUS, WORKORDER_STATUS, WORKORDER_TYPE } from '@/config/status'
import { fmtDate, fmtDateTime, fmtDuration, fmtKm, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fuelEfficiency, scheduleState, woCost } from './lib'
import type { VehicleKpis } from './useVehicleKpis'
import type { ShowVehicleDialog } from './VehicleDialogs'
import { useVehicleFuel, useVehicleSchedules, useVehicleTrips, useVehicleWorkOrders } from './useVehicleData'

interface TabProps {
  vehicle: Vehicle
  kpis: VehicleKpis
  show: ShowVehicleDialog
}

/* ------------------------------------------------------------------ */
/* Trip history                                                        */
/* ------------------------------------------------------------------ */
interface TripRow extends Trip {
  customerName: string
  driverName: string
  routeLabel: string
  duration: number
}

export function TripsTab({ vehicle }: TabProps) {
  const trips = useVehicleTrips(vehicle.id)
  const customers = useDb((s) => s.customers)
  const drivers = useDb((s) => s.drivers)
  const money = useMoney()

  const rows = useMemo<TripRow[]>(() => {
    const c = new Map(customers.map((x) => [x.id, x.name]))
    const d = new Map(drivers.map((x) => [x.id, x.name]))
    return trips.map((t) => ({ ...t, customerName: t.customerId ? (c.get(t.customerId) ?? '') : '', driverName: t.driverId ? (d.get(t.driverId) ?? '') : '', routeLabel: `${t.origin.city} → ${t.destination.city}`, duration: t.actualDurationMin ?? t.plannedDurationMin }))
  }, [trips, customers, drivers])

  const stats = useMemo(() => {
    const done = rows.filter((r) => r.status === 'completed')
    const onTime = done.filter((r) => r.delayMinutes <= 15).length
    return {
      total: rows.length,
      done: done.length,
      km: done.reduce((s, r) => s + (r.actualDistanceKm ?? r.plannedDistanceKm), 0),
      revenue: done.reduce((s, r) => s + r.revenueUsd, 0),
      onTime: done.length ? (onTime / done.length) * 100 : 0,
    }
  }, [rows])

  const columns = useMemo<ColumnDef<TripRow, any>[]>(
    () => [
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Trip', size: 130, cell: ({ row }) => <TripLink id={row.original.id} />, meta: { label: 'Trip' } },
      { id: 'status', accessorFn: (r) => r.status, header: 'Status', size: 150, filterFn: 'inArray', cell: ({ row }) => <Status kind="trip" value={row.original.status} />, meta: { label: 'Status', exportValue: (r) => TRIP_STATUS[r.status].label } },
      { id: 'route', accessorFn: (r) => r.routeLabel, header: 'Route', size: 190, meta: { label: 'Route' } },
      { id: 'customer', accessorFn: (r) => r.customerName, header: 'Customer', size: 160, cell: ({ row }) => <CustomerLink id={row.original.customerId} />, meta: { label: 'Customer' } },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} avatar />, meta: { label: 'Driver' } },
      { id: 'start', accessorFn: (r) => r.scheduledStart, header: 'Scheduled start', size: 150, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.scheduledStart)}</span>, meta: { label: 'Scheduled start' } },
      { id: 'distance', accessorFn: (r) => r.actualDistanceKm ?? r.plannedDistanceKm, header: 'Distance', size: 95, enableGlobalFilter: false, meta: { align: 'right', label: 'Distance (km)' }, cell: ({ row }) => fmtKm(row.original.actualDistanceKm ?? row.original.plannedDistanceKm) },
      {
        id: 'duration', accessorFn: (r) => r.duration, header: 'Planned / actual', size: 130, enableGlobalFilter: false, meta: { label: 'Duration (min)', align: 'right', exportValue: (r) => `${r.plannedDurationMin} planned / ${r.actualDurationMin ?? ''} actual` },
        cell: ({ row }) => <span className="num">{fmtDuration(row.original.plannedDurationMin)} <span className="text-subtle-foreground">/ {row.original.actualDurationMin ? fmtDuration(row.original.actualDurationMin) : '—'}</span></span>,
      },
      { id: 'delay', accessorFn: (r) => r.delayMinutes, header: 'Delay', size: 80, enableGlobalFilter: false, meta: { align: 'right', label: 'Delay (min)' }, cell: ({ row }) => (row.original.delayMinutes > 15 ? <span className="text-danger">{row.original.delayMinutes} min</span> : <span className="text-subtle-foreground">—</span>) },
      { id: 'revenue', accessorFn: (r) => r.revenueUsd, header: 'Revenue', size: 95, enableGlobalFilter: false, meta: { align: 'right', label: 'Revenue (USD)' }, cell: ({ row }) => money(row.original.revenueUsd) },
      { id: 'expenses', accessorFn: (r) => r.expensesUsd, header: 'Expenses', size: 95, enableGlobalFilter: false, meta: { align: 'right', label: 'Expenses (USD)' }, cell: ({ row }) => money(row.original.expensesUsd) },
    ],
    [money],
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Trips" value={stats.total} />
        <KpiCard label="Completed" value={stats.done} status="success" />
        <KpiCard label="Distance driven" value={Math.round(stats.km)} unit="km" format={(n) => fmtNumber(n)} />
        <KpiCard label="Revenue" value={money(stats.revenue, { compact: true })} />
        <KpiCard label="On-time rate" value={Math.round(stats.onTime)} unit="%" status={stats.onTime >= 85 ? 'success' : 'warning'} hint="Completed trips finishing ≤15 min after plan" />
      </div>
      <DataTable<TripRow>
        tableId="vehicle-trips"
        exportName={`${vehicle.reg.replace(' ', '')}-trips`}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        defaultSort={[{ id: 'start', desc: true }]}
        defaultPageSize={10}
        searchPlaceholder="Search trips, routes, customers…"
        onRowClick={(r) => useUi.getState().openTrip(r.id)}
        facets={[{ columnId: 'status', label: 'Status', options: Object.entries(TRIP_STATUS).map(([value, m]) => ({ value, label: m.label })) }]}
        emptyTitle="No trips for this vehicle"
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between"><TripLink id={r.id} /><Status kind="trip" value={r.status} /></div>
            <div className="text-[13px]">{r.routeLabel}</div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>{fmtDateTime(r.scheduledStart)}</span><span>{fmtKm(r.actualDistanceKm ?? r.plannedDistanceKm)}</span></div>
          </div>
        )}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */
interface WoRow extends WorkOrder {
  providerName: string
  cost: number
}
interface ScheduleRow extends ServiceSchedule {
  state: 'overdue' | 'due_soon' | 'ok'
  dueTs: number
  kmLeft: number
}

export function MaintenanceTab({ vehicle: v, kpis, show }: TabProps) {
  const canEdit = useCan('vehicles.edit')
  const money = useMoney()
  const workOrders = useVehicleWorkOrders(v.id)
  const schedules = useVehicleSchedules(v.id)
  const providers = useDb((s) => s.providers)

  const woRows = useMemo<WoRow[]>(() => {
    const p = new Map(providers.map((x) => [x.id, x.name]))
    return workOrders.map((w) => ({ ...w, providerName: p.get(w.providerId) ?? '', cost: woCost(w) }))
  }, [workOrders, providers])

  const scheduleRows = useMemo<ScheduleRow[]>(() => {
    const now = Date.now()
    return schedules.map((s) => ({ ...s, state: scheduleState(s, kpis.odometer, now), dueTs: new Date(s.nextDueDate).getTime(), kmLeft: Math.round(s.nextDueKm - kpis.odometer) })).sort((a, b) => a.dueTs - b.dueTs)
  }, [schedules, kpis.odometer])

  const lifetime = workOrders.filter((w) => w.status === 'completed').reduce((s, w) => s + woCost(w), 0)
  const downtime12 = workOrders.filter((w) => w.status === 'completed' && w.completedAt && Date.now() - new Date(w.completedAt).getTime() <= 365 * 864e5).reduce((s, w) => s + w.downtimeHours, 0)

  const scheduleColumns = useMemo<ColumnDef<ScheduleRow, any>[]>(
    () => [
      { id: 'task', accessorFn: (r) => r.task, header: 'Service task', size: 200 },
      { id: 'interval', accessorFn: (r) => r.intervalKm ?? 0, header: 'Interval', size: 150, enableSorting: false, cell: ({ row }) => <span className="num text-muted-foreground">{row.original.intervalKm ? fmtKm(row.original.intervalKm) : '—'} / {row.original.intervalDays ?? '—'} d</span> },
      { id: 'last', accessorFn: (r) => r.lastServiceDate, header: 'Last service', size: 150, cell: ({ row }) => <span className="num">{fmtDate(row.original.lastServiceDate)} <span className="text-subtle-foreground">· {fmtNumber(row.original.lastServiceKm)} km</span></span> },
      {
        id: 'next', accessorFn: (r) => r.dueTs, header: 'Next due', size: 190,
        cell: ({ row }) => (
          <span className={cn('num', row.original.state === 'overdue' && 'font-medium text-danger')}>
            {fmtDate(row.original.dueTs)} <span className="text-subtle-foreground">· {fmtNumber(row.original.nextDueKm)} km</span>
            <span className="block text-[11px] text-subtle-foreground">{row.original.kmLeft < 0 ? `${fmtNumber(-row.original.kmLeft)} km over` : `${fmtNumber(row.original.kmLeft)} km left`}</span>
          </span>
        ),
      },
      {
        id: 'state', accessorFn: (r) => r.state, header: 'Status', size: 110,
        cell: ({ row }) => <Badge tone={row.original.state === 'overdue' ? 'danger' : row.original.state === 'due_soon' ? 'warning' : 'success'}>{row.original.state === 'overdue' ? 'Overdue' : row.original.state === 'due_soon' ? 'Due soon' : 'OK'}</Badge>,
      },
      { id: 'cost', accessorFn: (r) => r.estCostUsd, header: 'Est. cost', size: 90, meta: { align: 'right' }, cell: ({ row }) => money(row.original.estCostUsd) },
      {
        id: 'actions', header: '', size: 120, enableSorting: false, enableHiding: false, enableResizing: false,
        cell: ({ row }) => canEdit ? <Button size="xs" variant="outline" onClick={() => show({ kind: 'maintenance', vehicle: v, preset: { title: row.original.task, type: 'preventive' } })}><CalendarPlus /> Schedule</Button> : null,
      },
    ],
    [money, canEdit, show, v],
  )

  const woColumns = useMemo<ColumnDef<WoRow, any>[]>(
    () => [
      { id: 'woNo', accessorFn: (r) => r.woNo, header: 'Work order', size: 110, cell: ({ row }) => <EntityLink type="workorder" id={row.original.id} />, meta: { label: 'Work order' } },
      { id: 'type', accessorFn: (r) => r.type, header: 'Type', size: 120, filterFn: 'inArray', cell: ({ row }) => WORKORDER_TYPE[row.original.type], meta: { label: 'Type', exportValue: (r) => WORKORDER_TYPE[r.type] } },
      { id: 'title', accessorFn: (r) => r.title, header: 'Title', size: 230, meta: { label: 'Title' } },
      { id: 'priority', accessorFn: (r) => r.priority, header: 'Priority', size: 90, cell: ({ row }) => <Badge tone={PRIORITY[row.original.priority]!.tone}>{PRIORITY[row.original.priority]!.label}</Badge>, meta: { label: 'Priority' } },
      { id: 'status', accessorFn: (r) => r.status, header: 'Status', size: 120, filterFn: 'inArray', cell: ({ row }) => <Status kind="workorder" value={row.original.status} />, meta: { label: 'Status', exportValue: (r) => WORKORDER_STATUS[r.status].label } },
      { id: 'provider', accessorFn: (r) => r.providerName, header: 'Provider', size: 190, meta: { label: 'Provider' } },
      { id: 'date', accessorFn: (r) => r.scheduledDate, header: 'Scheduled', size: 110, cell: ({ row }) => <span className="num">{fmtDate(row.original.scheduledDate)}</span>, meta: { label: 'Scheduled' } },
      { id: 'cost', accessorFn: (r) => r.cost, header: 'Cost', size: 90, enableGlobalFilter: false, meta: { align: 'right', label: 'Cost (USD)' }, cell: ({ row }) => (row.original.cost ? money(row.original.cost) : '—') },
      { id: 'downtime', accessorFn: (r) => r.downtimeHours, header: 'Downtime', size: 90, enableGlobalFilter: false, meta: { align: 'right', label: 'Downtime (h)' }, cell: ({ row }) => (row.original.downtimeHours ? `${row.original.downtimeHours} h` : '—') },
    ],
    [money],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open work orders" value={kpis.openWorkOrders.length} icon={Wrench} status={kpis.openWorkOrders.length ? 'warning' : 'success'} />
        <KpiCard label="Lifetime maintenance" value={money(lifetime, { compact: true })} hint="Labour + parts on completed work orders" />
        <KpiCard label="Downtime (12 months)" value={downtime12} unit="h" />
        <KpiCard label="Services overdue" value={kpis.service.overdueCount} status={kpis.service.overdueCount ? 'danger' : 'success'} />
      </div>
      <Panel
        title="Service schedules"
        description="Preventive tasks by interval — status uses both date and odometer"
        actions={canEdit ? <Button size="sm" onClick={() => show({ kind: 'maintenance', vehicle: v })}><CalendarPlus /> Schedule maintenance</Button> : undefined}
        flush
      >
        <DataTable<ScheduleRow> tableId="vehicle-schedules" data={scheduleRows} columns={scheduleColumns} getRowId={(r) => r.id} bare className="rounded-none border-0" emptyTitle="No service schedules" emptyDescription="Preventive schedules are created in Maintenance → Service schedules." defaultPageSize={10} pageSizes={[10, 25]} />
      </Panel>
      <DataTable<WoRow>
        tableId="vehicle-work-orders"
        exportName={`${v.reg.replace(' ', '')}-work-orders`}
        data={woRows}
        columns={woColumns}
        getRowId={(r) => r.id}
        defaultSort={[{ id: 'date', desc: true }]}
        defaultPageSize={10}
        searchPlaceholder="Search work orders…"
        facets={[
          { columnId: 'status', label: 'Status', options: Object.entries(WORKORDER_STATUS).map(([value, m]) => ({ value, label: m.label })) },
          { columnId: 'type', label: 'Type', options: Object.entries(WORKORDER_TYPE).map(([value, label]) => ({ value, label })) },
        ]}
        emptyTitle="No work orders"
        emptyDescription="Schedule maintenance to create the first one."
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between"><EntityLink type="workorder" id={r.id} /><Status kind="workorder" value={r.status} /></div>
            <div className="text-[13px]">{r.title}</div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>{WORKORDER_TYPE[r.type]} · {fmtDate(r.scheduledDate)}</span><span>{r.cost ? money(r.cost) : '—'}</span></div>
          </div>
        )}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fuel history                                                        */
/* ------------------------------------------------------------------ */
interface FuelRow extends FuelTransaction {
  stationName: string
  driverName: string
  l100: number | null
  km: number | null
  state: 'Flagged' | 'OK'
}

type Window = '30' | '90' | 'all'

export function FuelTab({ vehicle: v }: TabProps) {
  const money = useMoney()
  const fuel = useVehicleFuel(v.id)
  const allFuel = useDb((s) => s.fuelTransactions)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const getStation = useById('fuelStations')
  const [win, setWin] = useState<Window>('90')

  const rows = useMemo<FuelRow[]>(() => {
    const eff = fuelEfficiency(fuel)
    const d = new Map(drivers.map((x) => [x.id, x.name]))
    return fuel.map((f) => ({ ...f, stationName: getStation(f.stationId)?.name ?? '', driverName: f.driverId ? (d.get(f.driverId) ?? '') : '', l100: eff.get(f.id)?.l100 ?? null, km: eff.get(f.id)?.km ?? null, state: f.flag ? 'Flagged' : 'OK' }))
  }, [fuel, drivers, getStation])

  const inWin = useMemo(() => {
    if (win === 'all') return rows
    const from = Date.now() - Number(win) * 864e5
    return rows.filter((r) => new Date(r.date).getTime() >= from)
  }, [rows, win])

  // category benchmark: fleet-wide litres / km for vehicles of the same category
  const benchmark = useMemo(() => {
    const ids = new Set(vehicles.filter((x) => x.category === v.category).map((x) => x.id))
    const by = new Map<string, FuelTransaction[]>()
    for (const f of allFuel) if (ids.has(f.vehicleId)) (by.get(f.vehicleId) ?? by.set(f.vehicleId, []).get(f.vehicleId)!).push(f)
    let litres = 0
    let km = 0
    for (const list of by.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date))
      const eff = fuelEfficiency(list)
      for (const f of list) {
        const e = eff.get(f.id)
        if (e) { litres += f.litres; km += e.km }
      }
    }
    return km ? (litres / km) * 100 : null
  }, [allFuel, vehicles, v.category])

  const stats = useMemo(() => {
    const litres = inWin.reduce((s, r) => s + r.litres, 0)
    const spend = inWin.reduce((s, r) => s + r.totalUsd, 0)
    const withEff = inWin.filter((r) => r.l100 !== null)
    const km = withEff.reduce((s, r) => s + (r.km ?? 0), 0)
    const effLitres = withEff.reduce((s, r) => s + r.litres, 0)
    return { litres, spend, price: litres ? spend / litres : 0, l100: km ? (effLitres / km) * 100 : null, flagged: inWin.filter((r) => r.flag).length }
  }, [inWin])

  const chart = useMemo(() => inWin.map((r) => ({ label: format(new Date(r.date), 'd MMM'), title: `${fmtDateTime(r.date)} · ${r.stationName}`, litres: Math.round(r.litres), l100: r.l100 !== null ? Math.round(r.l100 * 10) / 10 : null })), [inWin])

  const columns = useMemo<ColumnDef<FuelRow, any>[]>(
    () => [
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Transaction', size: 120, cell: ({ row }) => <EntityLink type="fuel" id={row.original.id} />, meta: { label: 'Transaction' } },
      { id: 'date', accessorFn: (r) => r.date, header: 'Date', size: 150, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.date)}</span>, meta: { label: 'Date' } },
      { id: 'station', accessorFn: (r) => r.stationName, header: 'Station', size: 190, meta: { label: 'Station' } },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} avatar />, meta: { label: 'Driver' } },
      { id: 'litres', accessorFn: (r) => r.litres, header: 'Litres', size: 80, enableGlobalFilter: false, meta: { align: 'right', label: 'Litres' }, cell: ({ row }) => fmtNumber(row.original.litres, 1) },
      { id: 'price', accessorFn: (r) => r.pricePerLitreUsd, header: 'Price / L', size: 85, enableGlobalFilter: false, meta: { align: 'right', label: 'Price/L (USD)' }, cell: ({ row }) => money(row.original.pricePerLitreUsd, { digits: 2 }) },
      { id: 'total', accessorFn: (r) => r.totalUsd, header: 'Total', size: 85, enableGlobalFilter: false, meta: { align: 'right', label: 'Total (USD)' }, cell: ({ row }) => money(row.original.totalUsd) },
      { id: 'odo', accessorFn: (r) => r.odometerKm, header: 'Odometer', size: 100, enableGlobalFilter: false, meta: { align: 'right', label: 'Odometer (km)' }, cell: ({ row }) => fmtKm(row.original.odometerKm) },
      { id: 'eff', accessorFn: (r) => r.l100 ?? -1, header: 'L/100 km', size: 90, enableGlobalFilter: false, meta: { align: 'right', label: 'L/100km', exportValue: (r) => (r.l100 === null ? '' : Math.round(r.l100 * 10) / 10) }, cell: ({ row }) => (row.original.l100 === null ? <span className="text-subtle-foreground">—</span> : <span className={cn(benchmark && row.original.l100 > benchmark * 1.25 && 'text-warning')}>{row.original.l100.toFixed(1)}</span>) },
      { id: 'state', accessorFn: (r) => r.state, header: 'Flag', size: 150, filterFn: 'inArray', meta: { label: 'Flag', exportValue: (r) => r.flag?.reason ?? '' }, cell: ({ row }) => (row.original.flag ? <Badge tone={row.original.flag.severity === 'high' ? 'danger' : 'warning'} title={row.original.flag.reason}>{row.original.flag.severity} risk</Badge> : <span className="text-subtle-foreground">—</span>) },
      { id: 'reconciled', accessorFn: (r) => (r.reconciled ? 'Yes' : 'No'), header: 'Reconciled', size: 90, meta: { label: 'Reconciled' } },
    ],
    [money, benchmark],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Fuel purchased" value={Math.round(stats.litres)} unit="L" format={(n) => fmtNumber(n)} />
        <KpiCard label="Fuel spend" value={money(stats.spend)} />
        <KpiCard label="Avg price / litre" value={money(stats.price, { digits: 2 })} />
        <KpiCard
          label="Avg consumption"
          value={stats.l100 !== null ? stats.l100.toFixed(1) : '—'}
          unit="L/100km"
          status={stats.l100 !== null && benchmark ? (stats.l100 > benchmark * 1.15 ? 'warning' : 'success') : undefined}
          hint={benchmark ? `Category average ${benchmark.toFixed(1)} L/100km` : undefined}
        />
        <KpiCard label="Flagged fills" value={stats.flagged} status={stats.flagged ? 'danger' : 'success'} hint="Suspicious consumption rules" />
      </div>
      <ChartCard
        title="Fuel purchases & consumption"
        description={benchmark ? `Category average ${benchmark.toFixed(1)} L/100 km` : 'Litres per fill and tank-to-tank L/100 km'}
        actions={<Segmented<Window> aria-label="Period" value={win} onChange={setWin} options={[{ value: '30', label: '30d' }, { value: '90', label: '90d' }, { value: 'all', label: 'All' }]} />}
      >
        <TimeSeriesChart
          data={chart}
          titleKey="title"
          height={230}
          yFormat={(n) => `${n} L`}
          y2Format={(n) => `${n}`}
          series={[
            { key: 'litres', label: 'Litres filled', type: 'bar', color: 'var(--chart-2)', format: (n) => `${fmtNumber(n)} L` },
            { key: 'l100', label: 'L/100 km', type: 'line', axis: 'right', color: 'var(--chart-3)', format: (n) => `${n.toFixed(1)} L/100km` },
          ]}
          empty="No fuel transactions in this period"
        />
      </ChartCard>
      <DataTable<FuelRow>
        tableId="vehicle-fuel"
        exportName={`${v.reg.replace(' ', '')}-fuel`}
        data={inWin}
        columns={columns}
        getRowId={(r) => r.id}
        defaultSort={[{ id: 'date', desc: true }]}
        defaultPageSize={10}
        searchPlaceholder="Search fills, stations, drivers…"
        facets={[{ columnId: 'state', label: 'Flag', options: [{ value: 'Flagged', label: 'Flagged' }, { value: 'OK', label: 'No flag' }] }]}
        emptyTitle="No fuel transactions"
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between"><EntityLink type="fuel" id={r.id} />{r.flag && <Badge tone="warning">flagged</Badge>}</div>
            <div className="text-[13px]">{fmtNumber(r.litres, 1)} L · {money(r.totalUsd)}</div>
            <div className="text-xs text-muted-foreground">{r.stationName} · {fmtDateTime(r.date)}</div>
          </div>
        )}
      />
    </div>
  )
}

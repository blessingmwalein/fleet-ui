import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { ArrowRightLeft, Fuel, Gauge, MapPin, Navigation, Unlink } from 'lucide-react'
import type { Driver } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useMoney } from '@/hooks/useMoney'
import { useUi } from '@/store/ui'
import { Panel, Timeline } from '@/components/shared/Page'
import { CategoryBadge, Plate, Status } from '@/components/shared/Status'
import { CustomerLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/form-controls'
import { EmptyState } from '@/components/shared/EmptyState'
import { DataTable } from '@/components/data-table/DataTable'
import { TRIP_STATUS } from '@/config/status'
import { fmtDate, fmtDateTime, fmtDuration, fmtKm, fmtNumber, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { tripDate, tripKm } from '../driverData'
import { unassignVehicleFlow } from '../driverFlows'
import type { DriverDialogsApi } from '../DriverDialogs'

interface TabProps {
  driver: Driver
  dlg: DriverDialogsApi
  canEdit: boolean
}

/* ================================================================================================ Assigned vehicles */
interface VehicleHistoryRow {
  vehicleId: string
  reg: string
  model: string
  trips: number
  km: number
  first: string
  last: string
  current: boolean
}
const vh = createColumnHelper<VehicleHistoryRow>()

export function VehiclesTab({ driver, dlg, canEdit }: TabProps) {
  const vehicles = useDb((s) => s.vehicles)
  const trips = useDb((s) => s.trips)
  const audit = useDb((s) => s.auditLog)
  const vehicle = driver.vehicleId ? vehicles.find((v) => v.id === driver.vehicleId) : undefined
  const tel = useLive((s) => (driver.vehicleId ? s.telemetry[driver.vehicleId] : undefined))

  const history = useMemo<VehicleHistoryRow[]>(() => {
    const byVehicle = new Map<string, VehicleHistoryRow>()
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    for (const t of trips) {
      if (t.driverId !== driver.id || !t.vehicleId || t.status === 'cancelled') continue
      const v = vById.get(t.vehicleId)
      if (!v) continue
      const when = t.actualStart ?? t.scheduledStart
      const cur = byVehicle.get(v.id) ?? { vehicleId: v.id, reg: v.reg, model: `${v.make} ${v.model}`, trips: 0, km: 0, first: when, last: when, current: v.id === driver.vehicleId }
      cur.trips++
      if (t.status === 'completed') cur.km += tripKm(t)
      if (when < cur.first) cur.first = when
      if (when > cur.last) cur.last = when
      byVehicle.set(v.id, cur)
    }
    if (driver.vehicleId && vehicle && !byVehicle.has(driver.vehicleId)) byVehicle.set(vehicle.id, { vehicleId: vehicle.id, reg: vehicle.reg, model: `${vehicle.make} ${vehicle.model}`, trips: 0, km: 0, first: new Date().toISOString(), last: new Date().toISOString(), current: true })
    return [...byVehicle.values()].sort((a, b) => b.last.localeCompare(a.last))
  }, [trips, vehicles, driver.id, driver.vehicleId, vehicle])

  const assignLog = useMemo(() => audit.filter((a) => a.entityType === 'driver' && a.entityId === driver.id && a.action === 'assign').slice(0, 8), [audit, driver.id])

  return (
    <div className="space-y-3">
      <Panel
        title="Current assignment"
        actions={
          canEdit ? (
            <>
              <Button variant="outline" size="xs" onClick={() => dlg.openAssign(driver.id)}><ArrowRightLeft /> {vehicle ? 'Change vehicle' : 'Assign vehicle'}</Button>
              {vehicle && <Button variant="outline" size="xs" onClick={() => void unassignVehicleFlow(driver)}><Unlink /> Unassign</Button>}
            </>
          ) : undefined
        }
      >
        {!vehicle ? (
          <EmptyState compact icon={Navigation} title="No vehicle assigned" description="Assign a vehicle so this driver can be dispatched on trips." action={canEdit ? <Button size="sm" onClick={() => dlg.openAssign(driver.id)}>Assign vehicle</Button> : undefined} />
        ) : (
          <div className="grid gap-4 md:grid-cols-[1.2fr_2fr]">
            <div>
              <div className="flex items-center gap-2">
                <Link to={`/vehicles/${vehicle.id}`} className="hover:text-primary hover:underline"><Plate className="text-lg">{vehicle.reg}</Plate></Link>
                <Status kind="vehicle" value={vehicle.status} />
              </div>
              <p className="mt-1 text-[13px]">{vehicle.make} {vehicle.model} · {vehicle.year}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <CategoryBadge category={vehicle.category} />
                <span>{vehicle.fuelType} · {fmtNumber(vehicle.loadCapacityKg)} kg</span>
              </div>
              <Button asChild variant="soft" size="sm" className="mt-3"><Link to={`/tracking?vehicle=${vehicle.id}`}><MapPin /> Track on map</Link></Button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <div className="label-xs mb-1">Live state</div>
                {tel ? <Status kind="live" value={tel.state} /> : <span className="text-xs text-muted-foreground">No signal</span>}
              </div>
              <div>
                <div className="label-xs mb-1 flex items-center gap-1"><Gauge className="size-3" />Speed</div>
                <span className="num text-[13px] font-medium">{tel ? `${Math.round(tel.speedKph)} km/h` : '—'}</span>
              </div>
              <div>
                <div className="label-xs mb-1">Odometer</div>
                <span className="num text-[13px] font-medium">{fmtKm(tel?.odometerKm ?? vehicle.odometerKm)}</span>
              </div>
              <div>
                <div className="label-xs mb-1 flex items-center gap-1"><Fuel className="size-3" />Fuel</div>
                <div className="flex items-center gap-2"><Progress value={tel?.fuelPct ?? vehicle.fuelPct} className="w-16" indicatorClassName={(tel?.fuelPct ?? vehicle.fuelPct) < 15 ? 'bg-danger' : undefined} /><span className="num text-xs">{Math.round(tel?.fuelPct ?? vehicle.fuelPct)}%</span></div>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <div className="label-xs mb-1">Last known location</div>
                <span className="text-[13px]">{tel?.location ?? 'Unknown'}</span>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
        <DataTable
          tableId="driver-vehicle-history"
          data={history}
          getRowId={(r) => r.vehicleId}
          bare
          pageSizes={[5, 10, 25]}
          defaultPageSize={10}
          emptyTitle="No vehicle history"
          emptyDescription="Vehicles appear here once this driver has been rostered on trips."
          columns={[
            vh.accessor('reg', { header: 'Vehicle', size: 120, cell: ({ row }) => <span className="flex items-center gap-2"><VehicleLink id={row.original.vehicleId} />{row.original.current && <Badge tone="success">Current</Badge>}</span> }),
            vh.accessor('model', { header: 'Model', size: 170 }),
            vh.accessor('trips', { header: 'Trips', size: 70, meta: { align: 'right' } }),
            vh.accessor('km', { header: 'Distance', size: 100, meta: { align: 'right' }, cell: (c) => fmtKm(c.getValue()) }),
            vh.accessor('first', { header: 'First trip', size: 110, cell: (c) => <span className="num">{fmtDate(c.getValue())}</span> }),
            vh.accessor('last', { header: 'Last trip', size: 110, cell: (c) => <span className="num">{fmtDate(c.getValue())}</span> }),
          ]}
        />
        <Panel title="Assignment log" description="Allocations recorded in the audit log">
          {assignLog.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No assignment changes recorded yet.</p>
          ) : (
            <Timeline items={assignLog.map((a) => ({ id: a.id, title: a.summary, description: a.userName, time: timeAgo(a.at), tone: 'primary' }))} />
          )}
        </Panel>
      </div>
    </div>
  )
}

/* ================================================================================================ Trip history */
interface TripRow {
  id: string
  ref: string
  status: string
  route: string
  customerId: string | null
  customer: string
  vehicleId: string | null
  vehicleReg: string
  start: string
  plannedMin: number
  actualMin: number | null
  distanceKm: number
  delayMinutes: number
  revenueUsd: number
  expensesUsd: number
}
const tc = createColumnHelper<TripRow>()

export function TripsTab({ driver }: { driver: Driver }) {
  const trips = useDb((s) => s.trips)
  const vehicles = useDb((s) => s.vehicles)
  const customers = useDb((s) => s.customers)
  const money = useMoney()
  const openTrip = useUi((s) => s.openTrip)
  const rows = useMemo<TripRow[]>(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const cById = new Map(customers.map((c) => [c.id, c]))
    return trips
      .filter((t) => t.driverId === driver.id)
      .map((t) => ({
        id: t.id,
        ref: t.ref,
        status: t.status,
        route: `${t.origin.city} → ${t.destination.city}`,
        customerId: t.customerId,
        customer: t.customerId ? (cById.get(t.customerId)?.name ?? '') : '',
        vehicleId: t.vehicleId,
        vehicleReg: t.vehicleId ? (vById.get(t.vehicleId)?.reg ?? '') : '',
        start: t.actualStart ?? t.scheduledStart ?? tripDate(t),
        plannedMin: t.plannedDurationMin,
        actualMin: t.actualDurationMin,
        distanceKm: Math.round(tripKm(t)),
        delayMinutes: t.delayMinutes,
        revenueUsd: t.revenueUsd,
        expensesUsd: t.expensesUsd,
      }))
  }, [trips, vehicles, customers, driver.id])

  return (
    <DataTable
      tableId="driver-trips"
      data={rows}
      getRowId={(r) => r.id}
      exportName={`driver-${driver.empNo}-trips`}
      searchPlaceholder="Search trips, routes, customers…"
      defaultSort={[{ id: 'start', desc: true }]}
      onRowClick={(r) => openTrip(r.id)}
      facets={[{ columnId: 'status', label: 'Status', options: Object.entries(TRIP_STATUS).map(([value, m]) => ({ value, label: m.label })) }]}
      emptyTitle="No trips yet"
      emptyDescription="This driver has not been assigned to any trips."
      columns={[
        tc.accessor('ref', { header: 'Trip', size: 150, cell: ({ row }) => <TripLink id={row.original.id} /> }),
        tc.accessor('status', { header: 'Status', size: 150, filterFn: 'inArray', cell: (c) => <Status kind="trip" value={c.getValue()} /> }),
        tc.accessor('route', { header: 'Route', size: 190 }),
        tc.accessor('customer', { header: 'Customer', size: 170, cell: ({ row }) => <CustomerLink id={row.original.customerId} /> }),
        tc.accessor('vehicleReg', { header: 'Vehicle', size: 110, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> }),
        tc.accessor('start', { header: 'Start', size: 150, meta: { exportValue: (r) => r.start }, cell: (c) => <span className="num">{fmtDateTime(c.getValue())}</span> }),
        tc.accessor('distanceKm', { header: 'Distance', size: 90, meta: { align: 'right' }, cell: (c) => fmtKm(c.getValue()) }),
        tc.accessor('plannedMin', { header: 'Planned', size: 90, meta: { align: 'right', exportValue: (r) => r.plannedMin }, cell: (c) => fmtDuration(c.getValue()) }),
        tc.accessor('actualMin', { header: 'Actual', size: 90, meta: { align: 'right', exportValue: (r) => r.actualMin }, cell: (c) => fmtDuration(c.getValue()) }),
        tc.accessor('delayMinutes', { header: 'Delay', size: 90, meta: { align: 'right' }, cell: (c) => <span className={cn(c.getValue() > 15 && 'text-danger')}>{c.getValue() > 0 ? `${c.getValue()}m` : '—'}</span> }),
        tc.accessor('revenueUsd', { header: 'Revenue', size: 100, meta: { align: 'right' }, cell: (c) => money(c.getValue()) }),
      ]}
    />
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, CalendarClock, CheckCircle2, Eye, GitBranch, MapPin, Pencil, Plus, Trash2, Truck, UserCheck, UserX, Wrench } from 'lucide-react'
import type { Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useCan } from '@/hooks/useAuth'
import { useBranchScope } from '@/hooks/useFilters'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Page, PageHeader } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { CategoryBadge, CategoryIcon, Plate } from '@/components/shared/Status'
import { BranchLink, DriverLink } from '@/components/shared/EntityLink'
import { DataTable, actionsColumn } from '@/components/data-table/DataTable'
import { VEHICLE_CATEGORY } from '@/config/status'
import { fmtDate, fmtKm } from '@/lib/format'
import { FuelBar, NextServiceCell, VehicleStatusBadge } from './components'
import { STATUS_FACET_OPTIONS, serviceInfo, statusKeyOf, statusLabel, type ServiceInfo, type VehicleStatusKey } from './lib'
import { useVehicleDialogs } from './VehicleDialogs'
import { confirmAndDeleteVehicles } from './deleteFlow'

export interface VehicleRow extends Vehicle {
  statusKey: VehicleStatusKey
  driverName: string
  branchName: string
  odo: number
  fuel: number
  location: string
  svc: ServiceInfo
  dueTs: number
  assigned: 'Assigned' | 'Unassigned'
}

type Segment = 'all' | 'active' | 'maintenance' | 'out_of_service' | 'unassigned' | 'overdue'

export default function VehiclesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branches = useDb((s) => s.branches)
  const schedules = useDb((s) => s.schedules)
  const telemetry = useLive((s) => s.telemetry)
  const { scope } = useBranchScope()
  const canCreate = useCan('vehicles.create')
  const canEdit = useCan('vehicles.edit')
  const canDelete = useCan('vehicles.delete')
  const dlg = useVehicleDialogs()
  const [segment, setSegment] = useState<Segment>('all')

  // `?new=1` (top-bar Create menu / ⌘K) opens the register dialog
  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) dlg.show({ kind: 'create' })
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('new')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canCreate])

  // Enriched rows (TanStack caches accessors until `data` changes → rebuild whenever telemetry/lookups change)
  const rows = useMemo<VehicleRow[]>(() => {
    const driverName = new Map(drivers.map((d) => [d.id, d.name]))
    const branchOf = new Map(branches.map((b) => [b.id, b]))
    const byVehicle = new Map<string, typeof schedules>()
    for (const s of schedules) (byVehicle.get(s.vehicleId) ?? byVehicle.set(s.vehicleId, []).get(s.vehicleId)!).push(s)
    const now = Date.now()
    return scope(vehicles).map((v) => {
      const live = telemetry[v.id]
      const odo = Math.round(live?.odometerKm ?? v.odometerKm)
      const svc = serviceInfo(byVehicle.get(v.id), odo, now)
      const branch = branchOf.get(v.branchId)
      return {
        ...v,
        statusKey: statusKeyOf(v, live),
        driverName: v.driverId ? (driverName.get(v.driverId) ?? '') : '',
        branchName: branch?.name ?? '',
        odo,
        fuel: Math.round(live?.fuelPct ?? v.fuelPct),
        location: live?.location ?? (branch ? `${branch.city} depot` : '—'),
        svc,
        dueTs: svc.dueTs ?? 8.64e15,
        assigned: v.driverId ? 'Assigned' : 'Unassigned',
      }
    })
  }, [vehicles, drivers, branches, schedules, telemetry, scope])

  const counts = useMemo(() => {
    const live = (k: VehicleStatusKey) => rows.filter((r) => r.statusKey === k).length
    return {
      all: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      maintenance: rows.filter((r) => r.status === 'maintenance').length,
      out_of_service: rows.filter((r) => r.status === 'out_of_service').length,
      unassigned: rows.filter((r) => !r.driverId).length,
      overdue: rows.filter((r) => r.svc.overdue).length,
      moving: live('moving'),
      idle: live('idle'),
    }
  }, [rows])

  const data = useMemo(() => {
    switch (segment) {
      case 'active': return rows.filter((r) => r.status === 'active')
      case 'maintenance': return rows.filter((r) => r.status === 'maintenance')
      case 'out_of_service': return rows.filter((r) => r.status === 'out_of_service')
      case 'unassigned': return rows.filter((r) => !r.driverId)
      case 'overdue': return rows.filter((r) => r.svc.overdue)
      default: return rows
    }
  }, [rows, segment])

  const branchFacet = useMemo(() => branches.map((b) => ({ value: b.name, label: b.name })), [branches])
  const categoryFacet = useMemo(() => Object.entries(VEHICLE_CATEGORY).map(([value, label]) => ({ value, label })), [])

  const columns = useMemo<ColumnDef<VehicleRow, any>[]>(
    () => [
      {
        id: 'reg', accessorFn: (r) => r.reg, header: 'Registration', size: 128, meta: { label: 'Registration' },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <CategoryIcon category={row.original.category} className="size-3.5 text-muted-foreground" />
            <Plate>{row.original.reg}</Plate>
          </span>
        ),
      },
      {
        id: 'vehicle', accessorFn: (r) => `${r.make} ${r.model} ${r.year}`, header: 'Vehicle', size: 170, meta: { label: 'Vehicle' },
        cell: ({ row }) => (
          <div className="min-w-0 leading-tight">
            <div className="truncate">{row.original.make} {row.original.model}</div>
            <div className="truncate text-[11px] text-subtle-foreground">{row.original.year} · {VEHICLE_CATEGORY[row.original.category]}</div>
          </div>
        ),
      },
      { id: 'category', accessorFn: (r) => r.category, header: 'Category', size: 125, meta: { label: 'Category', exportValue: (r) => VEHICLE_CATEGORY[r.category] }, filterFn: 'inArray', cell: ({ row }) => <CategoryBadge category={row.original.category} /> },
      {
        id: 'driver', accessorFn: (r) => r.driverName, header: 'Assigned driver', size: 160, meta: { label: 'Assigned driver' },
        cell: ({ row }) => <DriverLink id={row.original.driverId} avatar fallback="Unassigned" />,
      },
      { id: 'assigned', accessorFn: (r) => r.assigned, header: 'Driver assigned', size: 110, filterFn: 'inArray', meta: { label: 'Driver assigned' } },
      { id: 'branch', accessorFn: (r) => r.branchName, header: 'Branch', size: 125, filterFn: 'inArray', meta: { label: 'Branch' }, cell: ({ row }) => <BranchLink id={row.original.branchId} /> },
      { id: 'odo', accessorFn: (r) => r.odo, header: 'Mileage', size: 100, enableGlobalFilter: false, meta: { label: 'Mileage', align: 'right', exportValue: (r) => r.odo }, cell: ({ row }) => <span className="num">{fmtKm(row.original.odo)}</span> },
      { id: 'fuel', accessorFn: (r) => r.fuel, header: 'Fuel', size: 110, enableGlobalFilter: false, meta: { label: 'Fuel %', exportValue: (r) => r.fuel }, cell: ({ row }) => <FuelBar pct={row.original.fuel} /> },
      {
        id: 'status', accessorFn: (r) => r.statusKey, header: 'Status', size: 125, filterFn: 'inArray', meta: { label: 'Status', exportValue: (r) => statusLabel(r.statusKey) },
        cell: ({ row }) => <VehicleStatusBadge statusKey={row.original.statusKey} />,
      },
      {
        id: 'location', accessorFn: (r) => r.location, header: 'Last location', size: 220, meta: { label: 'Last location' },
        cell: ({ row }) => (
          <span className="inline-flex max-w-full items-center gap-1 text-muted-foreground" title={row.original.location}>
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{row.original.location}</span>
          </span>
        ),
      },
      {
        id: 'nextService', accessorFn: (r) => r.dueTs, header: 'Next service', size: 135, enableGlobalFilter: false,
        meta: { label: 'Next service', exportValue: (r) => (r.svc.dueTs ? `${fmtDate(r.svc.dueTs)}${r.svc.overdue ? ' (overdue)' : ''} - ${r.svc.schedule?.task}` : '') },
        cell: ({ row }) => <NextServiceCell info={row.original.svc} />,
      },
      actionsColumn<VehicleRow>((r) => [
        { label: 'View details', icon: <Eye />, onClick: () => navigate(`/vehicles/${r.id}`) },
        { label: 'Edit vehicle', icon: <Pencil />, hidden: !canEdit, onClick: () => dlg.show({ kind: 'edit', vehicle: r }) },
        { label: r.driverId ? 'Change / unassign driver' : 'Assign driver', icon: <UserCheck />, hidden: !canEdit, onClick: () => dlg.show({ kind: 'assign', vehicle: r }) },
        { label: 'Update status', icon: <CheckCircle2 />, hidden: !canEdit, onClick: () => dlg.show({ kind: 'status', vehicles: [r] }) },
        { label: 'Schedule maintenance', icon: <Wrench />, hidden: !canEdit, onClick: () => dlg.show({ kind: 'maintenance', vehicle: r }) },
        { label: 'Track on map', icon: <MapPin />, onClick: () => navigate(`/tracking?vehicle=${r.id}`), separatorBefore: true },
        { label: 'Delete vehicle', icon: <Trash2 />, destructive: true, hidden: !canDelete, separatorBefore: true, onClick: () => void confirmAndDeleteVehicles([r]) },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canDelete, navigate],
  )

  const toggle = (s: Segment) => setSegment((cur) => (cur === s ? 'all' : s))

  return (
    <Page>
      <PageHeader
        title="Vehicles"
        description="Fleet register with live status, assignments, fuel and service health."
        actions={canCreate && <Button onClick={() => dlg.show({ kind: 'create' })}><Plus /> Register vehicle</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total vehicles" value={counts.all} icon={Truck} hint="Click to clear filters" onClick={() => setSegment('all')} status="info" className={segment === 'all' ? 'border-primary/50' : undefined} />
        <KpiCard label="Active" value={counts.active} icon={CheckCircle2} status="success" hint={`${counts.moving} moving · ${counts.idle} idle right now`} onClick={() => toggle('active')} className={segment === 'active' ? 'border-primary/50' : undefined} />
        <KpiCard label="In maintenance" value={counts.maintenance} icon={Wrench} status="warning" onClick={() => toggle('maintenance')} className={segment === 'maintenance' ? 'border-primary/50' : undefined} />
        <KpiCard label="Out of service" value={counts.out_of_service} icon={Ban} status={counts.out_of_service ? 'danger' : undefined} onClick={() => toggle('out_of_service')} className={segment === 'out_of_service' ? 'border-primary/50' : undefined} />
        <KpiCard label="Unassigned" value={counts.unassigned} icon={UserX} status={counts.unassigned ? 'warning' : undefined} hint="Vehicles without a driver" onClick={() => toggle('unassigned')} className={segment === 'unassigned' ? 'border-primary/50' : undefined} />
        <KpiCard label="Service overdue" value={counts.overdue} icon={CalendarClock} status={counts.overdue ? 'danger' : 'success'} hint="Past due date or due odometer" onClick={() => toggle('overdue')} className={segment === 'overdue' ? 'border-primary/50' : undefined} />
      </div>

      <DataTable<VehicleRow>
        tableId="vehicles"
        exportName="vehicles"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search registration, make, driver, location…"
        defaultSort={[{ id: 'reg', desc: false }]}
        defaultHidden={['assigned', 'category']}
        selectable
        onRowClick={(r) => navigate(`/vehicles/${r.id}`)}
        emptyTitle="No vehicles match"
        emptyDescription="Adjust the filters or register a new vehicle."
        facets={[
          { columnId: 'status', label: 'Status', options: STATUS_FACET_OPTIONS },
          { columnId: 'category', label: 'Category', options: categoryFacet },
          { columnId: 'branch', label: 'Branch', options: branchFacet },
          { columnId: 'assigned', label: 'Driver', options: [{ value: 'Assigned', label: 'Assigned' }, { value: 'Unassigned', label: 'Unassigned' }] },
        ]}
        toolbar={
          <Segmented<Segment>
            aria-label="Quick filter"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'all', label: `All ${counts.all}` },
              { value: 'active', label: `Active ${counts.active}` },
              { value: 'maintenance', label: `Maint. ${counts.maintenance}` },
              { value: 'out_of_service', label: `OOS ${counts.out_of_service}` },
              { value: 'unassigned', label: `Unassigned ${counts.unassigned}` },
              { value: 'overdue', label: `Overdue ${counts.overdue}` },
            ]}
            className="max-md:hidden"
          />
        }
        bulkActions={[
          ...(canEdit
            ? [
                { label: 'Change status', icon: <CheckCircle2 />, onClick: (sel: VehicleRow[], clear: () => void) => { dlg.show({ kind: 'status', vehicles: sel }); clear() } },
                { label: 'Assign branch', icon: <GitBranch />, onClick: (sel: VehicleRow[], clear: () => void) => { dlg.show({ kind: 'branch', vehicles: sel }); clear() } },
              ]
            : []),
          ...(canDelete ? [{ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: (sel: VehicleRow[], clear: () => void) => { void confirmAndDeleteVehicles(sel).then((done) => done.length && clear()) } }] : []),
        ]}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5"><CategoryIcon category={r.category} className="size-3.5 text-muted-foreground" /><Plate>{r.reg}</Plate></span>
              <VehicleStatusBadge statusKey={r.statusKey} />
            </div>
            <div className="text-[13px]">{r.make} {r.model} <span className="text-subtle-foreground">· {r.year}</span></div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <DriverLink id={r.driverId} avatar fallback="Unassigned" />
              <span>{r.branchName}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <FuelBar pct={r.fuel} />
              <span className="num text-xs text-muted-foreground">{fmtKm(r.odo)}</span>
            </div>
            <div className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" /><span className="truncate">{r.location}</span></div>
            {r.svc.overdue && <div className="text-xs font-medium text-danger">Service overdue · {r.svc.schedule?.task}</div>}
          </div>
        )}
      />
      {dlg.host}
    </Page>
  )
}

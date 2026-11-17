import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type ColumnDef, type ColumnFiltersState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { ArrowRightLeft, CalendarClock, Eye, Gauge, Pencil, Plus, Route as RouteIcon, ShieldAlert, Trash2, Unlink, UserCog, UserRound, Users } from 'lucide-react'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useBranchScope } from '@/hooks/useFilters'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { ExpiryBadge, Status } from '@/components/shared/Status'
import { VehicleLink } from '@/components/shared/EntityLink'
import { Avatar } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { BarList, DonutChart } from '@/components/charts/charts'
import { DataTable, actionsColumn } from '@/components/data-table/DataTable'
import { DRIVER_STATUS, expiryState } from '@/config/status'
import { fmtDate } from '@/lib/format'
import { avg } from '@/lib/utils'
import { BAND_META, EMPLOYMENT_LABEL, LICENCE_STATE_LABEL, STATUS_OPTIONS, useDriverRows, type DriverRow } from './driverData'
import { ScoreBar } from './DriverParts'
import { useDriverDialogs } from './DriverDialogs'
import { deleteDriversFlow, unassignVehicleFlow } from './driverFlows'

const col = createColumnHelper<DriverRow>()

const PRESETS: Record<string, ColumnFiltersState> = {
  all: [],
  active: [{ id: 'status', value: ['active'] }],
  unavailable: [{ id: 'status', value: ['on_leave', 'suspended'] }],
  licence: [{ id: 'licenceState', value: ['expired', 'expiring'] }],
  trip: [{ id: 'onTrip', value: ['yes'] }],
}

export default function DriversPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const rows = useDriverRows()
  const branches = useDb((s) => s.branches)
  const { scope } = useBranchScope()
  const data = useMemo(() => scope(rows), [rows, scope])
  const canCreate = useCan('drivers.create')
  const canEdit = useCan('drivers.edit')
  const canDelete = useCan('drivers.delete')
  const canExport = useCan('drivers.export')
  const dlg = useDriverDialogs()
  const [preset, setPreset] = useState('all')
  const togglePreset = (k: string) => setPreset((p) => (p === k ? 'all' : k))

  // ?new=1 deep link (top-bar Create menu / command palette)
  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) dlg.openCreate()
    else toast.error('Your role does not include permission to add drivers.')
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        n.delete('new')
        return n
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  /* ------------------------------ KPIs ------------------------------ */
  const kpi = useMemo(() => {
    const expiring = data.filter((d) => d.licenceState === 'expiring').length
    const expired = data.filter((d) => d.licenceState === 'expired').length
    return {
      total: data.length,
      active: data.filter((d) => d.status === 'active').length,
      unavailable: data.filter((d) => d.status === 'on_leave' || d.status === 'suspended').length,
      suspended: data.filter((d) => d.status === 'suspended').length,
      expiring,
      expired,
      avgScore: Math.round(avg(data.map((d) => d.safetyScore)) * 10) / 10,
      atRisk: data.filter((d) => d.band === 'poor').length,
      onTrip: data.filter((d) => d.activeTripId).length,
      noVehicle: data.filter((d) => !d.vehicleId).length,
    }
  }, [data])

  /* ------------------------------ Insight panels ------------------------------ */
  const watchlist = useMemo(() => {
    const items = data.flatMap((d) =>
      (
        [
          ['Licence', d.licenceExpiry],
          ['Medical', d.medicalExpiry],
          ['Defensive driving', d.defensiveDrivingExpiry],
        ] as const
      ).map(([label, iso]) => ({ d, label, iso, e: expiryState(iso, 30) })),
    )
    return items.filter((x) => x.e.state === 'expired' || x.e.state === 'expiring').sort((a, b) => a.e.days - b.e.days).slice(0, 6)
  }, [data])
  const bandCounts = useMemo(() => (['good', 'fair', 'poor'] as const).map((b) => ({ band: b, n: data.filter((d) => d.band === b).length })), [data])
  const statusMix = useMemo(
    () => [
      { name: 'Active', value: data.filter((d) => d.status === 'active').length, color: 'var(--success)' },
      { name: 'Off duty', value: data.filter((d) => d.status === 'off_duty').length, color: 'var(--subtle-foreground)' },
      { name: 'On leave', value: data.filter((d) => d.status === 'on_leave').length, color: 'var(--info)' },
      { name: 'Suspended', value: data.filter((d) => d.status === 'suspended').length, color: 'var(--danger)' },
    ],
    [data],
  )

  /* ------------------------------ Columns ------------------------------ */
  const columns = useMemo<ColumnDef<DriverRow, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Driver',
        size: 205,
        cell: ({ row }) => {
          const d = row.original
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={d.name} size={30} />
              <div className="min-w-0 leading-tight">
                <Link to={`/drivers/${d.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:text-primary hover:underline">{d.name}</Link>
                {d.activeTripId ? (
                  <span className="flex items-center gap-1 truncate text-[11px] text-success"><span className="size-1.5 shrink-0 rounded-full bg-success" />On trip · {d.activeTripRef}</span>
                ) : (
                  <span className="block truncate text-[11px] text-muted-foreground">{d.phone}</span>
                )}
              </div>
            </div>
          )
        },
      }),
      col.accessor('empNo', { header: 'Employee no.', size: 100, cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
      col.accessor('licenceNo', {
        header: 'Licence no.',
        size: 135,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs">{row.original.licenceNo}</span>
            <span className="rounded bg-surface-3 px-1 py-px text-[10px] font-medium text-muted-foreground">{row.original.licenceClass.replace('Class ', 'Cl ')}</span>
          </span>
        ),
      }),
      col.accessor('licenceExpiry', {
        header: 'Licence expiry',
        size: 185,
        meta: { exportValue: (d) => d.licenceExpiry.slice(0, 10) },
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="num w-[5.6rem] shrink-0">{fmtDate(row.original.licenceExpiry)}</span>
            <ExpiryBadge iso={row.original.licenceExpiry} showValid={false} />
          </span>
        ),
      }),
      col.accessor('vehicleReg', {
        header: 'Vehicle',
        size: 100,
        cell: ({ row }) => (row.original.vehicleId ? <VehicleLink id={row.original.vehicleId} /> : <span className="text-xs text-subtle-foreground">Unassigned</span>),
      }),
      col.accessor('branchName', { header: 'Branch', size: 125, filterFn: 'inArray' }),
      col.accessor('tripsCompleted', { header: 'Trips', size: 62, meta: { align: 'right', label: 'Trips completed' } }),
      col.accessor('safetyScore', { header: 'Safety score', size: 115, cell: (c) => <ScoreBar score={c.getValue()} /> }),
      col.accessor('status', { header: 'Status', size: 100, filterFn: 'inArray', cell: (c) => <Status kind="driver" value={c.getValue()} /> }),

      // --- optional columns (Columns menu) ---
      col.accessor('phone', { header: 'Phone', size: 140 }),
      col.accessor('email', { header: 'Email', size: 230 }),
      col.accessor('hireDate', { header: 'Hire date', size: 110, meta: { exportValue: (d) => d.hireDate.slice(0, 10) }, cell: (c) => <span className="num">{fmtDate(c.getValue())}</span> }),
      col.accessor('employmentType', { header: 'Employment', size: 110, cell: (c) => EMPLOYMENT_LABEL[c.getValue() as keyof typeof EMPLOYMENT_LABEL] }),
      col.accessor('medicalExpiry', {
        header: 'Medical expiry',
        size: 190,
        meta: { exportValue: (d) => d.medicalExpiry.slice(0, 10) },
        cell: ({ row }) => (
          <span className="flex items-center gap-2"><span className="num w-[5.6rem] shrink-0">{fmtDate(row.original.medicalExpiry)}</span><ExpiryBadge iso={row.original.medicalExpiry} showValid={false} /></span>
        ),
      }),
      col.accessor('defensiveDrivingExpiry', {
        header: 'Defensive driving expiry',
        size: 200,
        meta: { exportValue: (d) => d.defensiveDrivingExpiry.slice(0, 10) },
        cell: ({ row }) => (
          <span className="flex items-center gap-2"><span className="num w-[5.6rem] shrink-0">{fmtDate(row.original.defensiveDrivingExpiry)}</span><ExpiryBadge iso={row.original.defensiveDrivingExpiry} showValid={false} /></span>
        ),
      }),
      col.accessor('distanceKm', { header: 'Distance (km)', size: 110, meta: { align: 'right' }, cell: (c) => c.getValue().toLocaleString('en-US') }),
      col.accessor('onTimePct', { header: 'On-time %', size: 90, meta: { align: 'right', exportValue: (d) => d.onTimePct }, cell: (c) => (c.getValue() === null ? '—' : `${c.getValue()}%`) }),
      col.accessor('eventsPer1000', { header: 'Events / 1,000 km', size: 130, meta: { align: 'right', exportValue: (d) => d.eventsPer1000 }, cell: (c) => (c.getValue() === null ? '—' : c.getValue()) }),

      // --- facet-only helper columns (never shown, drive the Licence / Safety / Assignment filters) ---
      col.accessor('licenceState', { id: 'licenceState', header: 'Licence state', filterFn: 'inArray', enableHiding: false }),
      col.accessor('band', { id: 'band', header: 'Safety band', filterFn: 'inArray', enableHiding: false }),
      col.accessor((d) => (d.vehicleId ? 'assigned' : 'unassigned'), { id: 'assigned', header: 'Assignment', filterFn: 'inArray', enableHiding: false }),
      col.accessor((d) => (d.activeTripId ? 'yes' : 'no'), { id: 'onTrip', header: 'On trip', filterFn: 'inArray', enableHiding: false }),

      actionsColumn<DriverRow>((d) => [
        { label: 'View profile', icon: <Eye />, onClick: () => navigate(`/drivers/${d.id}`) },
        { label: 'Edit driver', icon: <Pencil />, onClick: () => dlg.openEdit(d.id), hidden: !canEdit },
        { label: d.vehicleId ? 'Change vehicle' : 'Assign vehicle', icon: <ArrowRightLeft />, onClick: () => dlg.openAssign(d.id), hidden: !canEdit },
        { label: 'Unassign vehicle', icon: <Unlink />, onClick: () => void unassignVehicleFlow(d), hidden: !canEdit || !d.vehicleId },
        { label: 'Change status', icon: <UserCog />, onClick: () => dlg.openStatus([d.id]), hidden: !canEdit },
        { label: 'Delete driver', icon: <Trash2 />, destructive: true, separatorBefore: true, onClick: () => void deleteDriversFlow([d]), hidden: !canDelete },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canDelete, navigate],
  )

  const hiddenByDefault = ['phone', 'email', 'hireDate', 'employmentType', 'medicalExpiry', 'defensiveDrivingExpiry', 'distanceKm', 'onTimePct', 'eventsPer1000', 'licenceState', 'band', 'assigned', 'onTrip']

  return (
    <Page>
      <PageHeader
        title="Drivers"
        description="Driver roster, licence compliance, vehicle assignment and safety performance across the fleet."
        actions={canCreate ? <Button onClick={dlg.openCreate}><Plus /> Add driver</Button> : undefined}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total drivers" value={kpi.total} icon={Users} hint={`${kpi.noVehicle} without an assigned vehicle`} onClick={() => togglePreset('all')} />
        <KpiCard label="Active" value={kpi.active} icon={UserRound} status="success" hint="Click to filter active drivers" onClick={() => togglePreset('active')} />
        <KpiCard label="On leave / suspended" value={kpi.unavailable} icon={CalendarClock} status={kpi.suspended ? 'warning' : 'neutral'} hint={`${kpi.suspended} suspended`} onClick={() => togglePreset('unavailable')} />
        <KpiCard label="Licences expiring" value={kpi.expiring} icon={ShieldAlert} status={kpi.expired ? 'danger' : kpi.expiring ? 'warning' : 'success'} hint={`${kpi.expired} already expired — click to list both`} onClick={() => togglePreset('licence')} />
        <KpiCard label="Avg safety score" value={kpi.avgScore} format={(n) => n.toFixed(1)} icon={Gauge} status={kpi.avgScore >= 85 ? 'success' : kpi.avgScore >= 70 ? 'warning' : 'danger'} hint={`${kpi.atRisk} drivers below 70`} />
        <KpiCard label="On trip now" value={kpi.onTrip} icon={RouteIcon} status="info" hint="Drivers on an in-transit or delayed trip" onClick={() => togglePreset('trip')} />
      </div>

      <div className="mb-3 hidden gap-3 lg:grid lg:grid-cols-3">
        <Panel title="Compliance watchlist" description="Licences, medicals and training expired or due ≤30 days" actions={<Button variant="ghost" size="xs" onClick={() => setPreset('licence')}>Filter table</Button>} bodyClassName="p-0">
          {watchlist.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">Everything is in date.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {watchlist.map((x) => (
                <li key={`${x.d.id}-${x.label}`} className="flex items-center gap-2.5 px-3.5 py-1.5">
                  <Avatar name={x.d.name} size={22} />
                  <Link to={`/drivers/${x.d.id}?tab=compliance`} className="min-w-0 flex-1 truncate text-[13px] hover:text-primary hover:underline">{x.d.name}</Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{x.label}</span>
                  <ExpiryBadge iso={x.iso} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Safety score bands" description={`Fleet average ${kpi.avgScore.toFixed(1)} · ${kpi.atRisk} at risk`}>
          <BarList
            items={bandCounts.map((b) => ({ label: BAND_META[b.band].label, value: b.n, color: BAND_META[b.band].color }))}
            format={(v) => `${v} driver${v === 1 ? '' : 's'}`}
            max={Math.max(1, kpi.total)}
          />
        </Panel>
        <Panel title="Roster status" description="Share of drivers by availability">
          <DonutChart data={statusMix} height={112} centerLabel="Drivers" centerValue={kpi.total} />
        </Panel>
      </div>

      <DataTable
        key={preset}
        tableId="drivers"
        data={data}
        columns={columns}
        getRowId={(d) => d.id}
        searchPlaceholder="Search name, employee no., licence, vehicle…"
        initialFilters={PRESETS[preset]}
        defaultHidden={hiddenByDefault}
        defaultSort={[{ id: 'name', desc: false }]}
        exportName={canExport ? 'drivers' : undefined}
        selectable={canEdit || canDelete}
        onRowClick={(d) => navigate(`/drivers/${d.id}`)}
        emptyTitle="No drivers match"
        emptyDescription="Adjust the search or filters, or add a new driver."
        facets={[
          { columnId: 'status', label: 'Status', options: STATUS_OPTIONS },
          { columnId: 'branchName', label: 'Branch', options: branches.map((b) => ({ value: b.name, label: b.name })) },
          { columnId: 'licenceState', label: 'Licence', options: (['expired', 'expiring', 'valid'] as const).map((v) => ({ value: v, label: LICENCE_STATE_LABEL[v] })) },
          { columnId: 'band', label: 'Safety', options: (['good', 'fair', 'poor'] as const).map((v) => ({ value: v, label: BAND_META[v].label })) },
          { columnId: 'assigned', label: 'Vehicle', options: [{ value: 'assigned', label: 'Has vehicle' }, { value: 'unassigned', label: 'Unassigned' }] },
        ]}
        bulkActions={[
          ...(canEdit ? [{ label: 'Change status', icon: <UserCog />, onClick: (sel: DriverRow[], clear: () => void) => dlg.openStatus(sel.map((d) => d.id), () => clear()) }] : []),
          ...(canDelete ? [{ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: async (sel: DriverRow[], clear: () => void) => { if (await deleteDriversFlow(sel)) clear() } }] : []),
        ]}
        mobileCard={(d) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={d.name} size={34} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{d.empNo} · {d.branchName}</div>
                </div>
              </div>
              <Status kind="driver" value={d.status} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">Vehicle {d.vehicleId ? <VehicleLink id={d.vehicleId} /> : <span className="text-subtle-foreground">Unassigned</span>}</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">Licence {fmtDate(d.licenceExpiry)} <ExpiryBadge iso={d.licenceExpiry} showValid={false} /></span>
            </div>
            <div className="flex items-center justify-between">
              <ScoreBar score={d.safetyScore} />
              <span className="text-xs text-muted-foreground">{d.tripsCompleted} trips{d.activeTripId ? <span className="ml-2 text-success">On trip</span> : null}</span>
            </div>
          </div>
        )}
      />
      {dlg.node}
    </Page>
  )
}

/** Status label helper re-exported for tests / other modules. */
export const driverStatusLabel = (s: keyof typeof DRIVER_STATUS) => DRIVER_STATUS[s].label

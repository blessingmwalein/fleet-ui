import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { addDays } from 'date-fns'
import { AlarmClockCheck, CalendarCheck2, ClipboardPlus, Gauge, Pencil, Plus, TimerReset, Trash2, TriangleAlert, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { useOpenParam } from '@/hooks/useLookup'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { DataTable, actionsColumn, type FacetFilter } from '@/components/data-table/DataTable'
import { fmtDate, fmtNumber } from '@/lib/format'
import { createWorkOrder, deleteSchedules } from './lib/actions'
import { useScheduleRows, type ScheduleRow } from './lib/data'
import { SCHEDULE_STATE, defaultProviderId, scheduleMarker } from './lib/maintenance'
import { useMaintenanceActions } from './components/MaintenanceActions'
import { ScheduleBadge, UsageBar } from './components/bits'
import { ReminderRow } from './components/ReminderRow'

type Segment = 'all' | 'overdue' | 'due_soon' | 'ok'

export default function SchedulesPage() {
  const rows = useScheduleRows()
  const branches = useDb((s) => s.branches)
  const vehicles = useDb((s) => s.vehicles)
  const providers = useDb((s) => s.providers)
  const money = useMoney()
  const canCreate = useCan('maintenance.create')
  const canEdit = useCan('maintenance.edit')
  const canDelete = useCan('maintenance.delete')
  const [segment, setSegment] = useState<Segment>('all')
  const [openId, setOpenId] = useOpenParam()
  const { sch, host } = useMaintenanceActions()

  const counts = useMemo(() => {
    const c = { all: rows.length, overdue: 0, due_soon: 0, ok: 0, cost: 0 }
    for (const r of rows) {
      c[r.state] += 1
      if (r.state !== 'ok') c.cost += r.estCostUsd
    }
    return c
  }, [rows])

  const urgent = useMemo(() => rows.filter((r) => r.state !== 'ok').sort((a, b) => a.health.urgency - b.health.urgency), [rows])
  const overdueList = urgent.filter((r) => r.state === 'overdue')
  const soonList = urgent.filter((r) => r.state === 'due_soon')
  const data = useMemo(() => (segment === 'all' ? rows : rows.filter((r) => r.state === segment)), [rows, segment])
  const selected = rows.find((r) => r.id === openId)

  const facets = useMemo<FacetFilter[]>(
    () => [
      { columnId: 'state', label: 'Status', options: (['overdue', 'due_soon', 'ok'] as const).map((v) => ({ value: v, label: SCHEDULE_STATE[v].label })) },
      { columnId: 'task', label: 'Task', options: [...new Set(rows.map((r) => r.task))].sort().map((t) => ({ value: t, label: t })) },
      { columnId: 'branchName', label: 'Branch', options: branches.map((b) => ({ value: b.name, label: b.name })) },
    ],
    [rows, branches],
  )

  const columns = useMemo<ColumnDef<ScheduleRow, any>[]>(
    () => [
      { accessorKey: 'reg', header: 'Vehicle', size: 140, cell: ({ row }) => <div className="leading-tight"><VehicleLink id={row.original.vehicleId} /><div className="truncate text-xs text-muted-foreground">{row.original.vehicleName}</div></div> },
      { accessorKey: 'task', header: 'Task', size: 190 },
      { id: 'interval', header: 'Interval', size: 140, accessorFn: (r) => [r.intervalKm ? `${fmtNumber(r.intervalKm)} km` : '', r.intervalDays ? `${r.intervalDays} d` : ''].filter(Boolean).join(' / ') },
      { accessorKey: 'lastServiceDate', header: 'Last service', size: 130, meta: { exportValue: (r) => `${fmtDate(r.lastServiceDate)} @ ${r.lastServiceKm} km` }, cell: ({ row }) => <div className="leading-tight"><div>{fmtDate(row.original.lastServiceDate)}</div><div className="num text-xs text-muted-foreground">{fmtNumber(row.original.lastServiceKm)} km</div></div> },
      { accessorKey: 'nextDueDate', header: 'Next due', size: 130, meta: { exportValue: (r) => `${fmtDate(r.nextDueDate)}${r.intervalKm ? ` @ ${r.nextDueKm} km` : ''}` }, cell: ({ row }) => <div className="leading-tight"><div>{row.original.intervalDays != null ? fmtDate(row.original.nextDueDate) : <span className="text-muted-foreground">est. {fmtDate(row.original.nextDueDate, 'dd MMM')}</span>}</div>{row.original.intervalKm ? <div className="num text-xs text-muted-foreground">{fmtNumber(row.original.nextDueKm)} km</div> : null}</div> },
      { accessorKey: 'remaining', header: 'Remaining', size: 170, sortingFn: (a, b) => a.original.health.urgency - b.original.health.urgency, cell: ({ row }) => <span className={row.original.state === 'overdue' ? 'font-medium text-danger' : row.original.state === 'due_soon' ? 'font-medium text-warning' : 'text-muted-foreground'}>{row.original.remaining}</span> },
      { accessorKey: 'state', header: 'Status', size: 96, meta: { exportValue: (r) => r.stateLabel }, cell: ({ row }) => <ScheduleBadge state={row.original.state} /> },
      { id: 'usage', header: 'Interval used', size: 130, accessorFn: (r) => Math.round(r.health.usedPct), cell: ({ row }) => <UsageBar pct={row.original.health.usedPct} state={row.original.state} /> },
      { accessorKey: 'estCostUsd', header: 'Est. cost', size: 90, meta: { align: 'right' }, cell: ({ row }) => money(row.original.estCostUsd) },
      { id: 'wo', header: 'Work order', size: 110, accessorFn: (r) => r.openWoNo ?? '', cell: ({ row }) => (row.original.openWoId ? <EntityLink type="workorder" id={row.original.openWoId} className="num">{row.original.openWoNo}</EntityLink> : <span className="text-subtle-foreground">—</span>) },
      { accessorKey: 'odometerKm', header: 'Odometer', size: 100, meta: { align: 'right' }, cell: ({ row }) => `${fmtNumber(row.original.odometerKm)} km` },
      { accessorKey: 'branchName', header: 'Branch', size: 150 },
      actionsColumn<ScheduleRow>((s) => [
        { label: 'Create work order', icon: <ClipboardPlus />, onClick: () => sch('create-wo', s), hidden: !canCreate || !!s.openWoId },
        { label: 'Mark serviced', icon: <AlarmClockCheck />, onClick: () => sch('serviced', s), hidden: !canEdit },
        { label: 'Edit schedule', icon: <Pencil />, onClick: () => sch('edit', s), hidden: !canEdit, separatorBefore: true },
        { label: 'Delete schedule', icon: <Trash2 />, onClick: () => sch('delete', s), hidden: !canDelete, destructive: true },
      ]),
    ],
    [money, sch, canCreate, canEdit, canDelete],
  )

  const bulkCreate = async (sel: ScheduleRow[], clear: () => void) => {
    const eligible = sel.filter((s) => !s.openWoId)
    if (!eligible.length) return void toast.info('Every selected schedule already has an open work order')
    if (!(await confirm({ title: `Raise ${eligible.length} work order${eligible.length > 1 ? 's' : ''}?`, description: 'One preventive work order is created per schedule, linked to it, using each vehicle’s default workshop.', confirmLabel: 'Raise work orders' }))) return
    for (const s of eligible) {
      const veh = vehicles.find((v) => v.id === s.vehicleId)
      createWorkOrder({
        vehicleId: s.vehicleId, type: 'preventive', title: s.task, priority: s.state === 'overdue' ? 'high' : 'medium', providerId: defaultProviderId(veh, branches, providers),
        scheduledDate: addDays(new Date(), 2).toISOString(), description: `Preventive maintenance raised from the service schedule "${s.task}".`, notes: `Raised from service schedule "${s.task}" ${scheduleMarker(s.id)}`,
      }, true)
    }
    toast.success(`${eligible.length} work order${eligible.length > 1 ? 's' : ''} requested`)
    clear()
  }

  const bulk = [
    ...(canCreate ? [{ label: 'Create work orders', icon: <ClipboardPlus />, onClick: bulkCreate }] : []),
    ...(canDelete ? [{
      label: 'Delete', icon: <Trash2 />, destructive: true,
      onClick: async (sel: ScheduleRow[], clear: () => void) => {
        if (await confirm({ title: `Delete ${sel.length} schedule${sel.length > 1 ? 's' : ''}?`, description: 'Service reminders for these tasks will stop.', confirmLabel: 'Delete', destructive: true })) { deleteSchedules(sel); clear() }
      },
    }] : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Service schedules"
        description="Preventive maintenance intervals per vehicle. A service is overdue when its distance or date limit is passed, and due soon within 14 days or 1,000 km."
        actions={canCreate && <Button onClick={() => sch('new')}><Plus /> New schedule</Button>}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Schedules" value={counts.all} icon={CalendarCheck2} onClick={() => setSegment('all')} />
        <KpiCard label="Overdue" value={counts.overdue} icon={TriangleAlert} status={counts.overdue ? 'danger' : 'success'} onClick={() => setSegment('overdue')} />
        <KpiCard label="Due soon" value={counts.due_soon} icon={TimerReset} status={counts.due_soon ? 'warning' : 'success'} onClick={() => setSegment('due_soon')} />
        <KpiCard label="On track" value={counts.ok} icon={Gauge} status="success" onClick={() => setSegment('ok')} />
        <KpiCard label="Est. cost to clear" value={money(counts.cost)} icon={Wrench} hint="Estimated cost of every overdue and due-soon service" />
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Service reminders — overdue" description={`${overdueList.length} overdue`} flush bodyClassName="max-h-60 overflow-y-auto">
          {overdueList.length === 0 ? <EmptyState compact title="Nothing overdue" description="All services are within their intervals." /> : (
            <ul className="divide-y divide-border/70">{overdueList.slice(0, 12).map((s) => <ReminderRow key={s.id} s={s} canCreate={canCreate} canEdit={canEdit} onCreate={() => sch('create-wo', s)} onServiced={() => sch('serviced', s)} />)}</ul>
          )}
        </Panel>
        <Panel title="Service reminders — due soon" description={`${soonList.length} due within 14 days / 1,000 km`} flush bodyClassName="max-h-60 overflow-y-auto">
          {soonList.length === 0 ? <EmptyState compact title="Nothing due soon" /> : (
            <ul className="divide-y divide-border/70">{soonList.slice(0, 12).map((s) => <ReminderRow key={s.id} s={s} canCreate={canCreate} canEdit={canEdit} onCreate={() => sch('create-wo', s)} onServiced={() => sch('serviced', s)} />)}</ul>
          )}
        </Panel>
      </div>

      <DataTable
        tableId="maintenance-schedules"
        exportName="service-schedules"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        facets={facets}
        searchPlaceholder="Search vehicle or task…"
        selectable
        bulkActions={bulk}
        defaultHidden={['odometerKm', 'branchName', 'estCostUsd']}
        defaultSort={[{ id: 'remaining', desc: false }]}
        onRowClick={(r) => setOpenId(r.id)}
        rowClassName={(r) => (r.state === 'overdue' ? 'bg-danger/5' : undefined)}
        toolbar={
          <Segmented<Segment>
            aria-label="Schedule status"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'all', label: `All ${counts.all}` },
              { value: 'overdue', label: `Overdue ${counts.overdue}` },
              { value: 'due_soon', label: `Due soon ${counts.due_soon}` },
              { value: 'ok', label: `OK ${counts.ok}` },
            ]}
          />
        }
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><VehicleLink id={r.vehicleId} /><ScheduleBadge state={r.state} /></div>
            <p className="text-[13px] font-medium">{r.task}</p>
            <p className={`text-xs ${r.state === 'overdue' ? 'text-danger' : r.state === 'due_soon' ? 'text-warning' : 'text-muted-foreground'}`}>{r.remaining}</p>
            <UsageBar pct={r.health.usedPct} state={r.state} />
          </div>
        )}
      />

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent size="md">
          {!selected ? (
            <>
              <SheetHeader><SheetTitle>Service schedule</SheetTitle><SheetDescription>Details</SheetDescription></SheetHeader>
              <EmptyState icon={Wrench} title="Schedule not found" description="It may have been deleted, or is outside the current branch scope." />
            </>
          ) : (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2 pr-6"><SheetTitle>{selected.task}</SheetTitle><ScheduleBadge state={selected.state} /></div>
                <SheetDescription>{selected.vehicleName} · <VehicleLink id={selected.vehicleId} /></SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <div className="rounded-lg border border-border bg-surface-2/50 p-3">
                  <div className="mb-2 flex items-baseline justify-between"><span className="label-xs">Interval consumed</span><span className={`text-sm font-semibold ${selected.state === 'overdue' ? 'text-danger' : selected.state === 'due_soon' ? 'text-warning' : ''}`}>{selected.remaining}</span></div>
                  <UsageBar pct={selected.health.usedPct} state={selected.state} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selected.health.basis === 'both' ? 'Both the date and distance limits are reached.' : selected.health.basis === 'date' ? 'Triggered by the date limit.' : selected.health.basis === 'distance' ? 'Triggered by the distance limit.' : 'Within both limits.'}
                  </p>
                </div>
                <DetailGrid
                  items={[
                    { label: 'Interval', value: [selected.intervalKm ? `${fmtNumber(selected.intervalKm)} km` : '', selected.intervalDays ? `${selected.intervalDays} days` : ''].filter(Boolean).join(' or ') },
                    { label: 'Estimated cost', value: money(selected.estCostUsd) },
                    { label: 'Last service', value: `${fmtDate(selected.lastServiceDate)} · ${fmtNumber(selected.lastServiceKm)} km` },
                    { label: 'Next due', value: `${fmtDate(selected.nextDueDate)}${selected.intervalKm ? ` · ${fmtNumber(selected.nextDueKm)} km` : ''}` },
                    { label: 'Current odometer', value: `${fmtNumber(selected.odometerKm)} km` },
                    { label: 'Branch', value: <EntityLink type="branch" id={selected.branchId}>{selected.branchName}</EntityLink> },
                    { label: 'Open work order', value: selected.openWoId ? <EntityLink type="workorder" id={selected.openWoId}>{selected.openWoNo}</EntityLink> : 'None' },
                  ]}
                />
                {selected.state !== 'ok' && !selected.openWoId && <Badge tone={selected.state === 'overdue' ? 'danger' : 'warning'}>No work order raised yet</Badge>}
              </SheetBody>
              <SheetFooter>
                {canDelete && <Button variant="outline" className="mr-auto text-danger" onClick={() => { void sch('delete', selected); setOpenId(null) }}><Trash2 /> Delete</Button>}
                {canEdit && <Button variant="outline" onClick={() => sch('edit', selected)}><Pencil /> Edit</Button>}
                {canEdit && <Button variant="outline" onClick={() => sch('serviced', selected)}><AlarmClockCheck /> Mark serviced</Button>}
                {canCreate && !selected.openWoId && <Button onClick={() => sch('create-wo', selected)}><ClipboardPlus /> Create work order</Button>}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
      {host}
    </Page>
  )
}

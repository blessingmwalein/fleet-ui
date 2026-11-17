import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, CheckCircle2, ClipboardCheck, Hourglass, Plus, Trash2, Wrench, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import type { WorkOrder } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { useOpenParam } from '@/hooks/useLookup'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { Page, PageHeader } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { Status } from '@/components/shared/Status'
import { VehicleLink } from '@/components/shared/EntityLink'
import { DataTable, actionsColumn, type FacetFilter } from '@/components/data-table/DataTable'
import { fmtDate } from '@/lib/format'
import { WORKORDER_TYPE } from '@/config/status'
import { cancelWorkOrders, currentUserName, approveWorkOrders, deleteWorkOrders } from './lib/actions'
import { useWorkOrderRows, type WoRow } from './lib/data'
import { NEXT_STEP, WO_PRIORITY_OPTIONS, WO_STATUS_OPTIONS, WO_TYPE_OPTIONS, isOpen } from './lib/maintenance'
import { useMaintenanceActions } from './components/MaintenanceActions'
import { WorkOrderDrawer, useWoActions } from './components/WorkOrderDrawer'
import { TypeTag } from './components/bits'

type Segment = 'all' | 'requests' | 'open' | 'workshop' | 'completed'

export default function WorkOrdersPage() {
  const rows = useWorkOrderRows()
  const providers = useDb((s) => s.providers)
  const branches = useDb((s) => s.branches)
  const money = useMoney()
  const canCreate = useCan('maintenance.create')
  const canEdit = useCan('maintenance.edit')
  const canApprove = useCan('maintenance.approve')
  const canDelete = useCan('maintenance.delete')
  const [segment, setSegment] = useState<Segment>('all')
  const [openId, setOpenId] = useOpenParam()
  const [params, setParams] = useSearchParams()
  const { wo: act, request, host } = useMaintenanceActions()
  const rowActions = useWoActions(act)

  // ?new=1 (+ optional ?vehicle=) opens the request form
  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) request({ vehicleId: params.get('vehicle') ?? undefined })
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); n.delete('vehicle'); return n }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const counts = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    return {
      all: rows.length,
      requests: rows.filter((r) => r.status === 'requested').length,
      open: rows.filter(isOpen).length,
      workshop: rows.filter((r) => r.status === 'in_progress').length,
      completed: rows.filter((r) => r.status === 'completed').length,
      booked: rows.filter((r) => r.status === 'approved' || r.status === 'scheduled').length,
      late: rows.filter((r) => r.late).length,
      mtd: rows.filter((r) => r.status === 'completed' && r.completedAt && new Date(r.completedAt) >= monthStart).reduce((s, r) => s + r.totalCost, 0),
    }
  }, [rows])

  const data = useMemo(() => {
    switch (segment) {
      case 'requests': return rows.filter((r) => r.status === 'requested')
      case 'open': return rows.filter(isOpen)
      case 'workshop': return rows.filter((r) => r.status === 'in_progress')
      case 'completed': return rows.filter((r) => r.status === 'completed')
      default: return rows
    }
  }, [rows, segment])

  const facets = useMemo<FacetFilter[]>(
    () => [
      { columnId: 'status', label: 'Status', options: WO_STATUS_OPTIONS },
      { columnId: 'type', label: 'Type', options: WO_TYPE_OPTIONS },
      { columnId: 'priority', label: 'Priority', options: WO_PRIORITY_OPTIONS },
      { columnId: 'providerName', label: 'Provider', options: providers.map((p) => ({ value: p.name, label: p.name })) },
      { columnId: 'branchName', label: 'Branch', options: branches.map((b) => ({ value: b.name, label: b.name })) },
    ],
    [providers, branches],
  )

  const columns = useMemo<ColumnDef<WoRow, any>[]>(
    () => [
      { accessorKey: 'woNo', header: 'WO no.', size: 100, meta: { label: 'WO no.' }, cell: ({ row }) => <button type="button" className="num font-medium text-primary hover:underline" onClick={() => setOpenId(row.original.id)}>{row.original.woNo}</button> },
      { accessorKey: 'reg', header: 'Vehicle', size: 140, cell: ({ row }) => <div className="leading-tight"><VehicleLink id={row.original.vehicleId} /><div className="truncate text-xs text-muted-foreground">{row.original.vehicleName}</div></div> },
      { accessorKey: 'type', header: 'Type', size: 120, meta: { exportValue: (r) => WORKORDER_TYPE[r.type] }, cell: ({ row }) => <TypeTag type={row.original.type} /> },
      { accessorKey: 'title', header: 'Title', size: 240, cell: ({ row }) => <span title={row.original.description}>{row.original.title}</span> },
      { accessorKey: 'priority', header: 'Priority', size: 90, cell: ({ row }) => <Status kind="priority" value={row.original.priority} dot={false} /> },
      { accessorKey: 'status', header: 'Status', size: 120, cell: ({ row }) => <Status kind="workorder" value={row.original.status} /> },
      { accessorKey: 'providerName', header: 'Provider', size: 190 },
      { accessorKey: 'scheduledDate', header: 'Scheduled', size: 110, meta: { exportValue: (r) => fmtDate(r.scheduledDate) }, cell: ({ row }) => <span className={row.original.late ? 'font-medium text-danger' : undefined} title={row.original.late ? 'Past its scheduled date and not started' : undefined}>{fmtDate(row.original.scheduledDate, 'dd MMM')}</span> },
      { accessorKey: 'technician', header: 'Technician', size: 130, cell: ({ row }) => row.original.technician || <span className="text-subtle-foreground">—</span> },
      { accessorKey: 'totalCost', header: 'Cost', size: 90, meta: { align: 'right' }, cell: ({ row }) => (row.original.status === 'requested' || row.original.status === 'cancelled' ? <span className="text-subtle-foreground">—</span> : money(row.original.totalCost)) },
      { accessorKey: 'downtimeHours', header: 'Downtime', size: 90, meta: { align: 'right' }, cell: ({ row }) => (row.original.downtimeHours ? `${row.original.downtimeHours} h` : <span className="text-subtle-foreground">—</span>) },
      { id: 'next', header: 'Next step', size: 108, enableSorting: false, meta: { label: 'Next step', exportValue: () => '' }, accessorFn: () => '', cell: ({ row }) => {
        const w = row.original
        const n = NEXT_STEP[w.status]
        if (!n || !(n.kind === 'approve' ? canApprove : canEdit)) return null
        return <Button size="xs" variant={n.kind === 'approve' ? 'soft' : 'outline'} onClick={() => act(n.kind, w)}>{n.label}</Button>
      } },
      { accessorKey: 'branchName', header: 'Branch', size: 150 },
      { accessorKey: 'requestedBy', header: 'Requested by', size: 130 },
      { accessorKey: 'labourCostUsd', header: 'Labour', size: 80, meta: { align: 'right' }, cell: ({ row }) => money(row.original.labourCostUsd) },
      { accessorKey: 'partsCostUsd', header: 'Parts', size: 80, meta: { align: 'right' }, cell: ({ row }) => money(row.original.partsCostUsd) },
      { accessorKey: 'completedAt', header: 'Completed', size: 110, meta: { exportValue: (r) => r.completedAt ?? '' }, cell: ({ row }) => fmtDate(row.original.completedAt) },
      actionsColumn<WoRow>((w) => rowActions(w)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, canApprove, canEdit, rowActions, act],
  )

  const bulkActions = [
    ...(canApprove ? [{ label: 'Approve', icon: <CheckCircle2 />, onClick: (sel: WoRow[], clear: () => void) => { approveWorkOrders(sel); clear() } }] : []),
    ...(canEdit ? [{
      label: 'Cancel',
      icon: <Ban />,
      onClick: async (sel: WoRow[], clear: () => void) => {
        const eligible = sel.filter((w) => w.status !== 'completed' && w.status !== 'cancelled')
        if (!eligible.length) return void toast.info('Nothing to cancel in the selection')
        if (await confirm({ title: `Cancel ${eligible.length} work order${eligible.length > 1 ? 's' : ''}?`, description: 'Vehicles currently in the workshop for these jobs are released back to service.', confirmLabel: 'Cancel work orders', destructive: true })) {
          cancelWorkOrders(eligible, `Bulk cancelled by ${currentUserName()}`)
          toast.success(`${eligible.length} work order${eligible.length > 1 ? 's' : ''} cancelled`)
          clear()
        }
      },
    }] : []),
    ...(canDelete ? [{
      label: 'Delete',
      icon: <Trash2 />,
      destructive: true,
      onClick: async (sel: WoRow[], clear: () => void) => {
        if (await confirm({ title: `Delete ${sel.length} work order${sel.length > 1 ? 's' : ''}?`, description: 'This permanently removes them, including any cost history. This cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
          deleteWorkOrders(sel as WorkOrder[])
          clear()
        }
      },
    }] : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Work orders"
        description="Maintenance requests and repair jobs from request to completion — approvals, scheduling, workshop bays, parts and costs."
        actions={canCreate && <Button onClick={() => request()}><Plus /> Request maintenance</Button>}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Awaiting approval" value={counts.requests} icon={Hourglass} status={counts.requests ? 'warning' : 'success'} onClick={() => setSegment('requests')} hint="Maintenance requests waiting for a decision" />
        <KpiCard label="Approved / scheduled" value={counts.booked} icon={CalendarClock} status="info" onClick={() => setSegment('open')} />
        <KpiCard label="In workshop now" value={counts.workshop} icon={Wrench} status={counts.workshop ? 'warning' : 'success'} onClick={() => setSegment('workshop')} />
        <KpiCard label="Late to start" value={counts.late} icon={ClipboardCheck} status={counts.late ? 'danger' : 'success'} hint="Approved or scheduled jobs whose date has passed" />
        <KpiCard label="Spend this month" value={money(counts.mtd)} icon={Wrench} hint="Completed work orders, month to date" />
      </div>

      <DataTable
        tableId="maintenance-work-orders"
        exportName="work-orders"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        facets={facets}
        searchPlaceholder="Search work orders, vehicles, providers…"
        selectable
        bulkActions={bulkActions}
        defaultHidden={['branchName', 'requestedBy', 'labourCostUsd', 'partsCostUsd', 'completedAt']}
        defaultSort={[{ id: 'scheduledDate', desc: true }]}
        onRowClick={(r) => setOpenId(r.id)}
        rowClassName={(r) => (r.priority === 'critical' && isOpen(r) ? 'bg-danger/5' : undefined)}
        emptyTitle={segment === 'requests' ? 'No pending requests' : 'No work orders found'}
        emptyDescription={segment === 'requests' ? 'All maintenance requests have been reviewed.' : 'Try adjusting the filters or request maintenance.'}
        toolbar={
          <Segmented<Segment>
            aria-label="Work order view"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'all', label: `All ${counts.all}` },
              { value: 'requests', label: <>Requests{counts.requests > 0 && <Badge tone="warning" className="px-1">{counts.requests}</Badge>}</> },
              { value: 'open', label: `Open ${counts.open}` },
              { value: 'workshop', label: `In workshop ${counts.workshop}` },
              { value: 'completed', label: `Completed ${counts.completed}` },
            ]}
          />
        }
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="num font-medium text-primary">{r.woNo}</span>
              <Status kind="workorder" value={r.status} />
            </div>
            <p className="text-[13px] font-medium">{r.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <VehicleLink id={r.vehicleId} />
              <TypeTag type={r.type} />
              <Status kind="priority" value={r.priority} dot={false} />
              <span className={r.late ? 'text-danger' : undefined}>{fmtDate(r.scheduledDate, 'dd MMM')}</span>
              {r.status !== 'requested' && <span className="num">{money(r.totalCost)}</span>}
            </div>
            {NEXT_STEP[r.status] && (NEXT_STEP[r.status]!.kind === 'approve' ? canApprove : canEdit) && (
              <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); act(NEXT_STEP[r.status]!.kind, r) }}>{NEXT_STEP[r.status]!.label}</Button>
            )}
          </div>
        )}
      />

      <WorkOrderDrawer id={openId} onClose={() => setOpenId(null)} />
      {host}
    </Page>
  )
}

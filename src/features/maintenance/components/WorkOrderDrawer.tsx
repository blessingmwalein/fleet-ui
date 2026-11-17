import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CalendarClock, CheckCheck, CheckCircle2, MoreHorizontal, Pencil, Play, Receipt, RotateCcw, Trash2, Wrench, XCircle } from 'lucide-react'
import type { WorkOrder } from '@/types'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DetailGrid, Panel, Timeline, type TimelineItem } from '@/components/shared/Page'
import { Status } from '@/components/shared/Status'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import type { RowAction } from '@/components/data-table/DataTable'
import { fmtDate, fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { VEHICLE_STATUS, WORKORDER_TYPE } from '@/config/status'
import { NEXT_STEP, cleanNotes, isLateStart, isOpen, linkedInspectionId, linkedScheduleId, partsTotal, woCost, type WoAction } from '../lib/maintenance'
import { useMaintenanceActions } from './MaintenanceActions'

/** Row-action menu items shared by the work-order table and drawer (RBAC applied). */
export function useWoActions(act: (k: WoAction, w: WorkOrder) => void) {
  const canEdit = useCan('maintenance.edit')
  const canApprove = useCan('maintenance.approve')
  const canDelete = useCan('maintenance.delete')
  return (w: WorkOrder): RowAction[] => {
    const open = isOpen(w)
    return [
      { label: 'Approve', icon: <CheckCircle2 />, onClick: () => act('approve', w), hidden: !(canApprove && w.status === 'requested') },
      { label: 'Reject request', icon: <XCircle />, onClick: () => act('reject', w), hidden: !(canApprove && w.status === 'requested') },
      { label: w.status === 'scheduled' ? 'Reschedule' : 'Schedule', icon: <CalendarClock />, onClick: () => act('schedule', w), hidden: !(canEdit && (w.status === 'approved' || w.status === 'scheduled')) },
      { label: 'Start work', icon: <Play />, onClick: () => act('start', w), hidden: !(canEdit && (w.status === 'approved' || w.status === 'scheduled')) },
      { label: 'Update parts & costs', icon: <Receipt />, onClick: () => act('progress', w), hidden: !(canEdit && w.status === 'in_progress') },
      { label: 'Complete work order', icon: <CheckCheck />, onClick: () => act('complete', w), hidden: !(canEdit && w.status === 'in_progress') },
      { label: 'Edit details', icon: <Pencil />, onClick: () => act('edit', w), hidden: !(canEdit && open), separatorBefore: true },
      { label: 'Cancel work order', icon: <Ban />, onClick: () => act('cancel', w), hidden: !(canEdit && open && w.status !== 'requested'), destructive: true },
      { label: 'Reopen as request', icon: <RotateCcw />, onClick: () => act('reopen', w), hidden: !(canEdit && w.status === 'cancelled') },
      { label: 'Delete', icon: <Trash2 />, onClick: () => act('delete', w), hidden: !canDelete, destructive: true, separatorBefore: true },
    ]
  }
}

export function WorkOrderDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const wo = useDb((s) => (id ? s.workOrders.find((w) => w.id === id) : undefined))
  const vehicle = useDb((s) => (wo ? s.vehicles.find((v) => v.id === wo.vehicleId) : undefined))
  const provider = useDb((s) => (wo ? s.providers.find((p) => p.id === wo.providerId) : undefined))
  const branch = useDb((s) => (wo ? s.branches.find((b) => b.id === wo.branchId) : undefined))
  const audit = useDb((s) => s.auditLog)
  const allWos = useDb((s) => s.workOrders)
  const schedule = useDb((s) => { const sid = linkedScheduleId(wo?.notes); return sid ? s.schedules.find((x) => x.id === sid) : undefined })
  const inspection = useDb((s) => { const iid = linkedInspectionId(wo?.notes); return iid ? s.inspections.find((x) => x.id === iid) : undefined })
  const money = useMoney()
  const { wo: act, host } = useMaintenanceActions()
  const actions = useWoActions(act)
  const canEdit = useCan('maintenance.edit')
  const canApprove = useCan('maintenance.approve')

  const activity = useMemo(() => (wo ? audit.filter((a) => a.entityType === 'work order' && a.entityId === wo.id).slice(0, 8) : []), [audit, wo])
  const related = useMemo(() => (wo ? allWos.filter((w) => w.vehicleId === wo.vehicleId && w.id !== wo.id).sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate)).slice(0, 4) : []), [allWos, wo])

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!wo) return []
    const approvedEntry = audit.find((a) => a.entityType === 'work order' && a.entityId === wo.id && a.action === 'approve')
    const past = (s: WorkOrder['status']) => ['approved', 'scheduled', 'in_progress', 'completed'].includes(s)
    const items: TimelineItem[] = [
      { id: 'req', title: 'Requested', time: fmtDateTime(wo.requestedAt), description: `by ${wo.requestedBy}` },
      { id: 'app', title: 'Approved', done: past(wo.status) || (wo.status === 'cancelled' && !!wo.startedAt), time: approvedEntry ? fmtDateTime(approvedEntry.at) : undefined, description: approvedEntry ? `by ${approvedEntry.userName}` : undefined },
      { id: 'sch', title: 'Scheduled', done: ['scheduled', 'in_progress', 'completed'].includes(wo.status), time: fmtDate(wo.scheduledDate), description: wo.technician ? `Technician ${wo.technician}` : undefined },
      { id: 'start', title: 'Work started', done: !!wo.startedAt, time: wo.startedAt ? fmtDateTime(wo.startedAt) : undefined, description: wo.status === 'in_progress' && wo.startedAt ? `In the workshop for ${timeAgo(wo.startedAt).replace(' ago', '')}` : undefined },
      { id: 'done', title: 'Completed', done: wo.status === 'completed', time: wo.completedAt ? fmtDateTime(wo.completedAt) : undefined, description: wo.status === 'completed' ? `${wo.downtimeHours} h downtime` : undefined },
    ]
    if (wo.status === 'cancelled') items.push({ id: 'x', title: 'Cancelled', tone: 'danger', done: true, icon: <Ban className="size-3" /> })
    return items
  }, [wo, audit])

  const next = wo ? NEXT_STEP[wo.status] : null
  const nextAllowed = !!wo && !!next && (next.kind === 'approve' ? canApprove : canEdit)
  const menu = wo ? actions(wo).filter((a) => !a.hidden) : []
  const parts = wo?.parts ?? []
  const notes = cleanNotes(wo?.notes)

  return (
    <>
      <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
        <SheetContent size="lg">
          {!wo ? (
            <>
              <SheetHeader><SheetTitle>Work order</SheetTitle><SheetDescription>Details</SheetDescription></SheetHeader>
              <EmptyState icon={Wrench} title="Work order not found" description="It may have been deleted or the link is out of date." />
            </>
          ) : (
            <>
              <SheetHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <SheetTitle className="num">{wo.woNo}</SheetTitle>
                  <Status kind="workorder" value={wo.status} />
                  <Status kind="priority" value={wo.priority} dot={false} />
                  {isLateStart(wo) && <Badge tone="danger">Late to start</Badge>}
                </div>
                <SheetDescription className="text-[13px] text-foreground">{wo.title}</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {[['Labour', wo.labourCostUsd], ['Parts', wo.partsCostUsd], ['Total', woCost(wo)]].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                      <div className="label-xs">{l}</div>
                      <div className="num mt-0.5 text-base font-semibold">{wo.status === 'requested' ? '—' : money(v as number)}</div>
                    </div>
                  ))}
                </div>

                <DetailGrid
                  items={[
                    { label: 'Vehicle', value: <span className="inline-flex items-center gap-1.5"><VehicleLink id={wo.vehicleId} /><span className="text-xs text-muted-foreground">{vehicle ? `${vehicle.make} ${vehicle.model}` : ''}</span></span> },
                    { label: 'Vehicle status', value: vehicle ? <Badge tone={VEHICLE_STATUS[vehicle.status].tone}>{VEHICLE_STATUS[vehicle.status].label}</Badge> : '—' },
                    { label: 'Type', value: WORKORDER_TYPE[wo.type] },
                    { label: 'Branch', value: <EntityLink type="branch" id={wo.branchId}>{branch?.name}</EntityLink> },
                    { label: 'Service provider', value: provider ? <Link to={`/maintenance/providers?open=${provider.id}`} className="hover:text-primary hover:underline">{provider.name}</Link> : '—' },
                    { label: 'Technician', value: wo.technician || 'Unassigned' },
                    { label: 'Requested', value: `${fmtDate(wo.requestedAt)} · ${wo.requestedBy}` },
                    { label: wo.status === 'completed' ? 'Scheduled for' : 'Scheduled date', value: fmtDate(wo.scheduledDate) },
                    { label: 'Started', value: wo.startedAt ? fmtDateTime(wo.startedAt) : '—' },
                    { label: 'Completed', value: wo.completedAt ? fmtDateTime(wo.completedAt) : '—' },
                    { label: 'Odometer', value: `${fmtNumber(wo.odometerKm)} km` },
                    { label: 'Downtime', value: wo.downtimeHours ? `${wo.downtimeHours} h` : '—' },
                  ]}
                />

                {(schedule || inspection) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-xs text-muted-foreground">
                    {schedule && <span>Raised from schedule <Link to={`/maintenance/schedules?open=${schedule.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{schedule.task}</Link></span>}
                    {inspection && <span>Raised from inspection <Link to={`/maintenance/inspections?open=${inspection.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{inspection.ref}</Link></span>}
                  </div>
                )}

                {(wo.description || notes) && (
                  <Panel title="Description & notes">
                    {wo.description && <p className="text-[13px] leading-relaxed">{wo.description}</p>}
                    {notes && <p className="mt-2 whitespace-pre-line border-t border-border pt-2 text-xs text-muted-foreground">{notes}</p>}
                  </Panel>
                )}

                <Panel title="Parts used" description={parts.length ? `${parts.length} line${parts.length === 1 ? '' : 's'}` : undefined} flush>
                  {parts.length === 0 ? (
                    <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{wo.status === 'in_progress' ? 'No parts recorded yet — use “Update parts & costs”.' : 'No parts recorded for this work order.'}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
                          <tr><th className="px-3 py-1.5 text-left font-medium">Part</th><th className="px-3 py-1.5 text-right font-medium">Qty</th><th className="px-3 py-1.5 text-right font-medium">Unit</th><th className="px-3 py-1.5 text-right font-medium">Total</th></tr>
                        </thead>
                        <tbody>
                          {parts.map((p, i) => (
                            <tr key={i} className="border-t border-border/70">
                              <td className="px-3 py-1.5"><div className="truncate">{p.name}</div><div className="font-mono text-[11px] text-subtle-foreground">{p.partNo}</div></td>
                              <td className="num px-3 py-1.5 text-right">{p.qty}</td>
                              <td className="num px-3 py-1.5 text-right">{money(p.unitCostUsd, { digits: 2 })}</td>
                              <td className="num px-3 py-1.5 text-right font-medium">{money(p.qty * p.unitCostUsd, { digits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border bg-surface-2/60 font-medium"><td className="px-3 py-1.5" colSpan={3}>Parts total</td><td className="num px-3 py-1.5 text-right">{money(partsTotal(parts), { digits: 2 })}</td></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </Panel>

                <div className="grid gap-4 md:grid-cols-2">
                  <Panel title="Lifecycle"><Timeline items={timeline} /></Panel>
                  <Panel title="Activity log">
                    {activity.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">No recorded changes yet.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {activity.map((a) => (
                          <li key={a.id} className="text-xs">
                            <p className="text-[13px]">{a.summary}</p>
                            <p className="text-subtle-foreground">{a.userName} · {timeAgo(a.at)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>

                {related.length > 0 && (
                  <Panel title="Other work orders on this vehicle" flush>
                    <ul className="divide-y divide-border/70">
                      {related.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]">
                          <EntityLink type="workorder" id={r.id} className="num shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.title}</span>
                          <Status kind="workorder" value={r.status} />
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </SheetBody>
              <SheetFooter>
                {menu.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal /> More actions</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      {menu.map((a) => (
                        <div key={a.label}>
                          {a.separatorBefore && <DropdownMenuSeparator />}
                          <DropdownMenuItem destructive={a.destructive} onSelect={() => { a.onClick(); }}>{a.icon}{a.label}</DropdownMenuItem>
                        </div>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {nextAllowed && next && <Button onClick={() => act(next.kind, wo)}>{next.label}</Button>}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
      {host}
    </>
  )
}

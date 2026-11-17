import { useCallback, useState, type ReactNode } from 'react'
import type { ServiceSchedule, WorkOrder } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { approveWorkOrders, deleteSchedules, deleteWorkOrders, reopenWorkOrder } from '../lib/actions'
import { scheduleMarker, type WoAction } from '../lib/maintenance'
import { CompleteWorkOrderDialog, ReasonDialog, ScheduleWorkOrderDialog, StartWorkOrderDialog, WorkOrderFormDialog, type WoDefaults } from './WorkOrderDialogs'
import { MarkServicedDialog, ScheduleFormDialog } from './ScheduleDialogs'
import type { ScheduleRow } from '../lib/data'

type Dlg =
  | { t: 'request'; defaults?: WoDefaults }
  | { t: 'edit' | 'schedule' | 'start' | 'progress' | 'complete' | 'reject' | 'cancel'; id: string }
  | { t: 'sch-form'; id?: string; vehicleId?: string }
  | { t: 'serviced'; id: string }
  | null

export type ScheduleAction = 'new' | 'edit' | 'serviced' | 'delete' | 'create-wo'

/**
 * One place that owns every maintenance dialog + confirmation. Pages call `wo(kind, workOrder)`,
 * `request(defaults)` or `sch(kind, schedule)` and render `host` once.
 */
export function useMaintenanceActions(): {
  wo: (kind: WoAction, w: WorkOrder) => void
  request: (defaults?: WoDefaults) => void
  sch: (kind: ScheduleAction, s?: ServiceSchedule | ScheduleRow, vehicleId?: string) => void
  host: ReactNode
} {
  const [dlg, setDlg] = useState<Dlg>(null)
  const workOrders = useDb((s) => s.workOrders)
  const schedules = useDb((s) => s.schedules)
  const canApprove = useCan('maintenance.approve')
  const close = useCallback((o: boolean) => { if (!o) setDlg(null) }, [])

  const wo = useCallback(
    async (kind: WoAction, w: WorkOrder) => {
      if (kind === 'approve') return void approveWorkOrders([w])
      if (kind === 'reopen') return void reopenWorkOrder(w)
      if (kind === 'delete') {
        const ok = await confirm({
          title: `Delete ${w.woNo}?`,
          description: w.status === 'completed' ? 'This removes the work order and its cost history from reports. This cannot be undone.' : 'This permanently removes the work order. This cannot be undone.',
          confirmLabel: 'Delete',
          destructive: true,
        })
        if (ok) deleteWorkOrders([w])
        return
      }
      setDlg({ t: kind, id: w.id })
    },
    [],
  )

  const request = useCallback((defaults?: WoDefaults) => setDlg({ t: 'request', defaults }), [])

  const sch = useCallback(
    async (kind: ScheduleAction, s?: ServiceSchedule | ScheduleRow, vehicleId?: string) => {
      if (kind === 'new') return setDlg({ t: 'sch-form', vehicleId })
      if (!s) return
      if (kind === 'edit') return setDlg({ t: 'sch-form', id: s.id })
      if (kind === 'serviced') return setDlg({ t: 'serviced', id: s.id })
      if (kind === 'create-wo') {
        const due = new Date(s.nextDueDate)
        const late = due.getTime() < Date.now()
        const d = new Date(Math.max(due.getTime(), Date.now() + 864e5))
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        return setDlg({
          t: 'request',
          defaults: { vehicleId: s.vehicleId, type: 'preventive', title: s.task, priority: late ? 'high' : 'medium', date, description: `Preventive maintenance raised from the service schedule "${s.task}".`, notes: `Raised from service schedule "${s.task}" ${scheduleMarker(s.id)}`, scheduleNow: canApprove },
        })
      }
      if (kind === 'delete') {
        const ok = await confirm({ title: `Delete schedule "${s.task}"?`, description: 'Reminders for this task will stop. Existing work orders are not affected.', confirmLabel: 'Delete', destructive: true })
        if (ok) deleteSchedules([s])
      }
    },
    [canApprove],
  )

  const woFor = (type: string) => (dlg && dlg.t === type && 'id' in dlg ? workOrders.find((w) => w.id === dlg.id) : undefined)
  const schFor = (type: string) => (dlg && dlg.t === type && 'id' in dlg && dlg.id ? schedules.find((s) => s.id === dlg.id) : undefined)

  const host = (
    <>
      <WorkOrderFormDialog open={dlg?.t === 'request'} onOpenChange={close} defaults={dlg?.t === 'request' ? dlg.defaults : undefined} />
      <WorkOrderFormDialog open={dlg?.t === 'edit'} onOpenChange={close} wo={woFor('edit')} />
      <ScheduleWorkOrderDialog open={dlg?.t === 'schedule'} onOpenChange={close} wo={woFor('schedule')} />
      <StartWorkOrderDialog open={dlg?.t === 'start'} onOpenChange={close} wo={woFor('start')} />
      <CompleteWorkOrderDialog open={dlg?.t === 'complete'} onOpenChange={close} wo={woFor('complete')} mode="complete" />
      <CompleteWorkOrderDialog open={dlg?.t === 'progress'} onOpenChange={close} wo={woFor('progress')} mode="progress" />
      <ReasonDialog open={dlg?.t === 'reject'} onOpenChange={close} wo={woFor('reject')} mode="reject" />
      <ReasonDialog open={dlg?.t === 'cancel'} onOpenChange={close} wo={woFor('cancel')} mode="cancel" />
      <ScheduleFormDialog open={dlg?.t === 'sch-form'} onOpenChange={close} schedule={schFor('sch-form')} vehicleId={dlg?.t === 'sch-form' ? dlg.vehicleId : undefined} />
      <MarkServicedDialog open={dlg?.t === 'serviced'} onOpenChange={close} schedule={schFor('serviced')} />
    </>
  )
  return { wo, request, sch, host }
}

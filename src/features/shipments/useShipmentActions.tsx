import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Shipment } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { ShipmentFormDialog } from './ShipmentFormDialog'
import { AllocateDialog, BulkAllocateDialog } from './AllocateDialog'
import { ExceptionDialog, PodDialog, ResolveExceptionDialog, StatusDialog } from './WorkflowDialogs'
import { canAllocate, canCapturePod, canRaiseException, canUpdateStatus, isOpenException, nextStage, type Stage } from './shipmentLib'

type Kind = 'form' | 'allocate' | 'status' | 'exception' | 'resolve' | 'pod' | 'bulk'

export interface ShipmentActions {
  register: (presetCustomerId?: string) => void
  edit: (s: Shipment) => void
  allocate: (s: Shipment) => void
  updateStatus: (s: Shipment) => void
  raiseException: (s: Shipment) => void
  resolveException: (s: Shipment) => void
  capturePod: (s: Shipment) => void
  bulkAllocate: (rows: Shipment[], clear?: () => void) => void
  /** Delete after confirmation; resolves true when removed. */
  remove: (s: Shipment) => Promise<boolean>
  bulkRemove: (rows: Shipment[], clear?: () => void) => Promise<boolean>
  /** Primary "next step" for a shipment (label + handler) or null when nothing applies. */
  nextStep: (s: Shipment) => { label: string; run: () => void } | null
  can: { create: boolean; edit: boolean; delete: boolean; export: boolean }
}

/**
 * Hosts every shipment dialog (register/edit, allocate, status, exception, POD, bulk) and exposes imperative openers.
 * Render `{dialogs}` once in the page.
 */
export function useShipmentActions(): ShipmentActions & { dialogs: ReactNode } {
  const canCreate = useCan('shipments.create')
  const canEdit = useCan('shipments.edit')
  const canDelete = useCan('shipments.delete')
  const canExport = useCan('shipments.export')
  const shipments = useDb((s) => s.shipments)

  const [open, setOpen] = useState<Kind | null>(null)
  // Keep the last target around so dialogs can finish their exit animation.
  const [target, setTarget] = useState<{ id?: string; preset?: string; bulk?: Shipment[]; clear?: () => void }>({})
  const [last, setLast] = useState<Kind>('form')

  const show = useCallback((kind: Kind, t: typeof target = {}) => {
    setTarget(t)
    setLast(kind)
    setOpen(kind)
  }, [])
  const close = useCallback(() => setOpen(null), [])

  const current = target.id ? shipments.find((s) => s.id === target.id) : undefined

  const remove = useCallback(async (s: Shipment) => {
    const ok = await confirm({
      title: `Delete shipment ${s.trackingRef}?`,
      description: s.tripId ? 'The shipment is removed permanently. The linked trip is kept and detached from this shipment.' : 'This permanently removes the shipment and its tracking history.',
      confirmLabel: 'Delete shipment',
      destructive: true,
    })
    if (!ok) return false
    const db = useDb.getState()
    if (s.tripId) {
      const t = db.trips.find((x) => x.id === s.tripId)
      if (t && t.shipmentId === s.id) db.update('trips', t.id, { shipmentId: null }, { silent: true })
    }
    db.remove('shipments', s.id, { summary: `Deleted shipment ${s.trackingRef}` })
    toast.success(`Shipment ${s.trackingRef} deleted`)
    return true
  }, [])

  const bulkRemove = useCallback(async (rows: Shipment[], clear?: () => void) => {
    const ok = await confirm({
      title: `Delete ${rows.length} shipment${rows.length === 1 ? '' : 's'}?`,
      description: 'This permanently removes the selected shipments. Linked trips are kept and detached.',
      confirmLabel: `Delete ${rows.length}`,
      destructive: true,
    })
    if (!ok) return false
    const db = useDb.getState()
    for (const s of rows) if (s.tripId) db.update('trips', s.tripId, { shipmentId: null }, { silent: true })
    db.removeMany('shipments', rows.map((r) => r.id))
    toast.success(`${rows.length} shipment${rows.length === 1 ? '' : 's'} deleted`)
    clear?.()
    return true
  }, [])

  const api: ShipmentActions = useMemo(
    () => ({
      register: (preset) => show('form', { preset }),
      edit: (s) => show('form', { id: s.id }),
      allocate: (s) => show('allocate', { id: s.id }),
      updateStatus: (s) => show('status', { id: s.id }),
      raiseException: (s) => show('exception', { id: s.id }),
      resolveException: (s) => show('resolve', { id: s.id }),
      capturePod: (s) => show('pod', { id: s.id }),
      bulkAllocate: (rows, clear) => show('bulk', { bulk: rows, clear }),
      remove,
      bulkRemove,
      nextStep: (s) => {
        if (!canEdit || isOpenException(s)) return null
        const next: Stage | null = nextStage(s)
        if (!next) return null
        if (canAllocate(s) && next === 'allocated') return { label: 'Allocate vehicle', run: () => show('allocate', { id: s.id }) }
        if (next === 'delivered') return canCapturePod(s) ? { label: 'Capture POD & deliver', run: () => show('pod', { id: s.id }) } : null
        if (canUpdateStatus(s)) return { label: `Mark ${next === 'picked_up' ? 'picked up' : next === 'in_transit' ? 'in transit' : 'out for delivery'}`, run: () => show('status', { id: s.id }) }
        return null
      },
      can: { create: canCreate, edit: canEdit, delete: canDelete, export: canExport },
    }),
    [show, remove, bulkRemove, canCreate, canEdit, canDelete, canExport],
  )

  const dialogs = (
    <>
      <ShipmentFormDialog open={open === 'form'} onOpenChange={(o) => !o && close()} shipment={last === 'form' ? current : undefined} presetCustomerId={target.preset} />
      <AllocateDialog open={open === 'allocate'} onOpenChange={(o) => !o && close()} shipment={current} />
      <StatusDialog open={open === 'status'} onOpenChange={(o) => !o && close()} shipment={current} />
      <ExceptionDialog open={open === 'exception'} onOpenChange={(o) => !o && close()} shipment={current} />
      <ResolveExceptionDialog open={open === 'resolve'} onOpenChange={(o) => !o && close()} shipment={current} />
      <PodDialog open={open === 'pod'} onOpenChange={(o) => !o && close()} shipment={current} />
      <BulkAllocateDialog open={open === 'bulk'} onOpenChange={(o) => !o && close()} shipments={target.bulk ?? []} onDone={target.clear} />
    </>
  )

  return { ...api, dialogs }
}

export { canAllocate, canCapturePod, canRaiseException, canUpdateStatus }

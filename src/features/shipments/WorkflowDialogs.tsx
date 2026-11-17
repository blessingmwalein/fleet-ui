import { useMemo } from 'react'
import { z } from 'zod'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import type { Shipment } from '@/types'
import { useDb } from '@/store/db'
import { eventBus } from '@/services/events'
import { FormDialog } from '@/components/forms/FormDialog'
import { DateField, FormGrid, NumberField, SelectField, SwitchField, TextAreaField, TextField, fromInputDate, toInputDateTime } from '@/components/forms/fields'
import { fmtDateTime } from '@/lib/format'
import {
  advanceMilestones, EXCEPTION_TYPES, exceptionMilestones, lastMilestoneAt, nextStage, reachedStage, stageIndex, stageMilestones, STAGE_LABEL, STAGES, type Stage,
} from './shipmentLib'

const nowInput = () => toInputDateTime(new Date().toISOString())

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------
export function StatusDialog({ open, onOpenChange, shipment }: { open: boolean; onOpenChange: (o: boolean) => void; shipment: Shipment | undefined }) {
  const s = shipment
  const lastAt = s ? lastMilestoneAt(s) : ''
  const options = useMemo(() => {
    if (!s) return []
    const from = stageIndex(reachedStage(s))
    return STAGES.filter((k, i) => i > from && i >= 2 && k !== 'delivered').map((k) => ({ value: k, label: `${STAGE_LABEL[k]}` }))
  }, [s])
  const schema = useMemo(
    () =>
      z
        .object({ stage: z.string().min(1, 'Select the new status'), at: z.string().min(1, 'Timestamp is required'), note: z.string().trim().max(240, 'Max 240 characters').optional() })
        .superRefine((v, ctx) => {
          if (!v.at) return
          const t = new Date(v.at).getTime()
          if (t > Date.now() + 5 * 6e4) ctx.addIssue({ code: 'custom', path: ['at'], message: 'Timestamp cannot be in the future' })
          if (lastAt && t < new Date(lastAt).getTime() - 60_000) ctx.addIssue({ code: 'custom', path: ['at'], message: `Cannot be earlier than the previous milestone (${fmtDateTime(lastAt)})` })
        }),
    [lastAt],
  )
  if (!s) return null

  const onSubmit = (v: z.output<typeof schema>) => {
    const db = useDb.getState()
    const cur = db.shipments.find((x) => x.id === s.id) ?? s
    const stage = v.stage as Stage
    const at = fromInputDate(v.at)
    db.update(
      'shipments',
      cur.id,
      { status: stage, milestones: advanceMilestones(cur, stage, at, v.note) },
      { action: 'status', summary: `Shipment ${cur.trackingRef} → ${STAGE_LABEL[stage]}` },
    )
    // moving cargo starts the linked trip so the vehicle shows up live
    const trip = cur.tripId ? db.trips.find((t) => t.id === cur.tripId) : undefined
    if (trip && (stage === 'in_transit' || stage === 'out_for_delivery') && (trip.status === 'ready' || trip.status === 'scheduled') && trip.vehicleId) {
      db.update('trips', trip.id, { status: 'in_transit', actualStart: at }, { action: 'status', summary: `Started trip ${trip.ref} (shipment ${cur.trackingRef} ${STAGE_LABEL[stage].toLowerCase()})` })
      toast.success(`${cur.trackingRef}: ${STAGE_LABEL[stage]}`, { description: `Trip ${trip.ref} started — vehicle is now live on the map` })
      return
    }
    toast.success(`${cur.trackingRef}: ${STAGE_LABEL[stage]}`)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Update shipment status"
      description={`${s.trackingRef} · currently ${STAGE_LABEL[reachedStage(s)].toLowerCase()}`}
      schema={schema}
      defaultValues={{ stage: nextStage(s) && nextStage(s) !== 'delivered' ? nextStage(s)! : (options[0]?.value ?? ''), at: nowInput(), note: '' }}
      onSubmit={onSubmit}
      submitLabel="Update status"
      size="md"
    >
      {(form) => (
        <>
          <SelectField form={form} name="stage" label="New status" required options={options} placeholder="Select status…" />
          <DateField form={form} name="at" label="Occurred at" required withTime hint="Recorded on the delivery timeline" />
          <TextAreaField form={form} name="note" label="Milestone note" rows={2} placeholder="e.g. Loaded and sealed, departed gate 3" />
          <p className="flex items-start gap-1.5 text-xs text-subtle-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            To complete the delivery, capture proof of delivery (POD) — it stamps the final milestone and closes the shipment.
          </p>
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Raise exception
// ---------------------------------------------------------------------------
const excSchema = z.object({
  type: z.string().min(1, 'Select an exception type'),
  description: z.string().trim().min(10, 'Describe what happened (min 10 characters)').max(400, 'Max 400 characters'),
})

export function ExceptionDialog({ open, onOpenChange, shipment }: { open: boolean; onOpenChange: (o: boolean) => void; shipment: Shipment | undefined }) {
  const s = shipment
  if (!s) return null
  const onSubmit = (v: z.output<typeof excSchema>) => {
    const db = useDb.getState()
    const cur = db.shipments.find((x) => x.id === s.id) ?? s
    const now = new Date().toISOString()
    db.update(
      'shipments',
      cur.id,
      {
        status: 'exception',
        exception: { type: v.type, description: v.description.trim(), raisedAt: now, resolved: false },
        milestones: [...cur.milestones, { key: 'exception', label: `Exception – ${v.type}`, at: now, note: v.description.trim() }],
      },
      { action: 'status', summary: `Raised exception on ${cur.trackingRef}: ${v.type}` },
    )
    eventBus.publish({ type: 'system', severity: 'warning', title: `Shipment exception – ${cur.trackingRef}`, message: `${v.type}: ${v.description.trim()}`, entity: { type: 'shipment', id: cur.id } })
    toast.warning(`Exception raised on ${cur.trackingRef}`, { description: v.type })
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Raise exception"
      description={`${s.trackingRef} · flags the shipment and pauses workflow until resolved`}
      schema={excSchema}
      defaultValues={{ type: '', description: '' }}
      onSubmit={onSubmit}
      submitLabel="Raise exception"
      destructive
      size="md"
    >
      {(form) => (
        <>
          <SelectField form={form} name="type" label="Exception type" required options={EXCEPTION_TYPES.map((t) => ({ value: t, label: t }))} placeholder="Select type…" />
          <TextAreaField form={form} name="description" label="What happened?" required rows={4} placeholder="Describe the issue, who reported it and any immediate action taken…" />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Resolve exception
// ---------------------------------------------------------------------------
const resolveSchema = z.object({ resolution: z.string().trim().min(5, 'Describe how it was resolved (min 5 characters)').max(300, 'Max 300 characters') })

export function ResolveExceptionDialog({ open, onOpenChange, shipment }: { open: boolean; onOpenChange: (o: boolean) => void; shipment: Shipment | undefined }) {
  const s = shipment
  if (!s?.exception) return null
  const exc = s.exception
  const onSubmit = (v: z.output<typeof resolveSchema>) => {
    const db = useDb.getState()
    const cur = db.shipments.find((x) => x.id === s.id) ?? s
    if (!cur.exception) return
    const now = new Date().toISOString()
    const restored = reachedStage(cur)
    db.update(
      'shipments',
      cur.id,
      {
        status: restored,
        exception: { ...cur.exception, resolved: true },
        milestones: [...stageMilestones(cur), ...exceptionMilestones(cur), { key: 'exception', label: `Exception resolved – ${cur.exception.type}`, at: now, note: v.resolution.trim() }],
      },
      { action: 'status', summary: `Resolved exception on ${cur.trackingRef}: ${cur.exception.type}` },
    )
    toast.success(`Exception resolved on ${cur.trackingRef}`, { description: `Status restored to ${STAGE_LABEL[restored].toLowerCase()}` })
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resolve exception"
      description={`${s.trackingRef} · ${exc.type}`}
      schema={resolveSchema}
      defaultValues={{ resolution: '' }}
      onSubmit={onSubmit}
      submitLabel="Mark resolved"
      size="md"
    >
      {(form) => (
        <>
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs">
            <p className="font-medium text-danger">{exc.type}</p>
            <p className="mt-0.5 text-muted-foreground">{exc.description}</p>
            <p className="mt-1 text-subtle-foreground">Raised {fmtDateTime(exc.raisedAt)}</p>
          </div>
          <TextAreaField form={form} name="resolution" label="Resolution" required rows={3} placeholder="e.g. ZIMRA clearance received, vehicle released from border post" />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Proof of delivery
// ---------------------------------------------------------------------------
export function PodDialog({ open, onOpenChange, shipment }: { open: boolean; onOpenChange: (o: boolean) => void; shipment: Shipment | undefined }) {
  const s = shipment
  const lastAt = s ? lastMilestoneAt(s) : ''
  const schema = useMemo(
    () =>
      z
        .object({
          receivedBy: z.string().trim().min(2, 'Enter the name of the person who received the goods').max(80),
          signedAt: z.string().min(1, 'Delivery time is required'),
          conditionOk: z.boolean(),
          photoCount: z.number({ error: 'Enter the number of photos (0 if none)' }).int('Whole number').min(0, 'Cannot be negative').max(20, 'Max 20 photos'),
          notes: z.string().trim().max(300, 'Max 300 characters').optional(),
        })
        .superRefine((v, ctx) => {
          if (v.signedAt) {
            const t = new Date(v.signedAt).getTime()
            if (t > Date.now() + 5 * 6e4) ctx.addIssue({ code: 'custom', path: ['signedAt'], message: 'Delivery time cannot be in the future' })
            if (lastAt && t < new Date(lastAt).getTime() - 60_000) ctx.addIssue({ code: 'custom', path: ['signedAt'], message: `Cannot be earlier than the previous milestone (${fmtDateTime(lastAt)})` })
          }
          if (!v.conditionOk && !v.notes?.trim()) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Describe the damage or shortage' })
        }),
    [lastAt],
  )
  if (!s) return null

  const onSubmit = (v: z.output<typeof schema>) => {
    const db = useDb.getState()
    const cur = db.shipments.find((x) => x.id === s.id) ?? s
    const at = fromInputDate(v.signedAt)
    const pod = { receivedBy: v.receivedBy.trim(), signedAt: at, notes: v.notes?.trim() || undefined, photoCount: v.photoCount, conditionOk: v.conditionOk }
    db.update(
      'shipments',
      cur.id,
      { status: 'delivered', deliveredAt: at, pod, milestones: advanceMilestones(cur, 'delivered', at, `POD signed by ${pod.receivedBy}${v.conditionOk ? '' : ' — condition issue noted'}`) },
      { action: 'status', summary: `Delivered ${cur.trackingRef} — POD signed by ${pod.receivedBy}` },
    )
    const trip = cur.tripId ? db.trips.find((t) => t.id === cur.tripId) : undefined
    if (trip && trip.status !== 'completed' && trip.status !== 'cancelled') {
      const live = trip.status === 'in_transit' || trip.status === 'delayed'
      const mins = trip.actualStart ? Math.max(1, Math.round((new Date(at).getTime() - new Date(trip.actualStart).getTime()) / 6e4)) : trip.plannedDurationMin
      db.update(
        'trips',
        trip.id,
        live ? { pod, status: 'completed', actualEnd: at, actualDurationMin: mins, actualDistanceKm: trip.plannedDistanceKm, delayMinutes: Math.max(0, mins - trip.plannedDurationMin) } : { pod },
        { silent: true },
      )
    } else if (trip) db.update('trips', trip.id, { pod }, { silent: true })
    eventBus.publish({ type: 'delivery_completed', severity: 'success', title: `Delivery completed – ${cur.trackingRef}`, message: `Delivered to ${cur.delivery.name}. POD signed by ${pod.receivedBy}.`, entity: { type: 'shipment', id: cur.id } })
    toast.success(`${cur.trackingRef} delivered`, { description: `POD signed by ${pod.receivedBy}${v.conditionOk ? '' : ' (condition issue noted)'}` })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Capture proof of delivery"
      description={`${s.trackingRef} · ${s.delivery.name}`}
      schema={schema}
      defaultValues={{ receivedBy: s.contactName, signedAt: nowInput(), conditionOk: true, photoCount: 1, notes: '' }}
      onSubmit={onSubmit}
      submitLabel="Confirm delivery"
      size="md"
    >
      {(form) => (
        <>
          <FormGrid>
            <TextField form={form} name="receivedBy" label="Received by" required placeholder="Full name of consignee" />
            <DateField form={form} name="signedAt" label="Signed at" required withTime />
            <NumberField form={form} name="photoCount" label="Photos captured" min={0} max={20} step={1} hint="Delivery note / cargo photos" />
          </FormGrid>
          <SwitchField form={form} name="conditionOk" label="Delivered in good condition" hint="Turn off if goods were damaged, short or rejected" />
          <TextAreaField form={form} name="notes" label="Delivery notes" rows={3} placeholder="Remarks from the receiver, seal numbers, shortages…" />
          <p className="flex items-start gap-1.5 text-xs text-subtle-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            Marks the shipment delivered, stamps all outstanding milestones and completes the linked trip.
          </p>
        </>
      )}
    </FormDialog>
  )
}

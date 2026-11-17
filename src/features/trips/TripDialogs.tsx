import * as React from 'react'
import { useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { ArrowRight, Camera, X } from 'lucide-react'
import type { Trip } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { getById } from '@/hooks/useLookup'
import { FormDialog } from '@/components/forms/FormDialog'
import { CheckboxField, ComboField, DateField, Field, NumberField, SelectField, TextAreaField, TextField, fromInputDate, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import { SwitchField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Plate } from '@/components/shared/Status'
import { fmtDateTime, fmtDuration } from '@/lib/format'
import { TRIP_STATUS } from '@/config/status'
import {
  CANCEL_REASONS, DELAY_REASONS, assignTrip, blockersOf, cancelTrip, checkAssignment, completeTrip, delayTrip, dispatchTrip, isActive, isDraft, isTerminal, warningsOf, type Check,
} from './tripLogic'
import { useTripDialogs } from './tripStore'
import { TripFormDialog } from './TripForm'
import { ChecksList, PriorityBadge, useCrewOptions } from './tripUi'

/** Compact identity line shown at the top of the workflow dialogs. */
function TripHeaderCard({ trip, extra }: { trip: Trip; extra?: React.ReactNode }) {
  const vehicle = getById('vehicles', trip.vehicleId)
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="num text-[13px] font-semibold">{trip.ref}</span>
        <div className="flex items-center gap-1.5">
          <PriorityBadge priority={trip.priority} />
          <Badge tone={TRIP_STATUS[trip.status].tone}>{TRIP_STATUS[trip.status].label}</Badge>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px]">
        <span>{trip.origin.name}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" />
        <span>{trip.destination.name}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {trip.cargoDescription} · {trip.cargoWeightKg.toLocaleString('en-US')} kg · {trip.plannedDistanceKm} km · starts {fmtDateTime(trip.scheduledStart)}
        {vehicle && <> · <Plate>{vehicle.reg}</Plate></>}
      </p>
      {extra}
    </div>
  )
}

function useTrips(ids: string[]) {
  const trips = useDb((s) => s.trips)
  return React.useMemo(() => trips.filter((t) => ids.includes(t.id)), [trips, ids])
}

/* ---------------------------------------------------------------------------------------------- *
 * Assign vehicle & driver (single or bulk)
 * ---------------------------------------------------------------------------------------------- */
const assignSchema = z.object({ vehicleId: z.string().min(1, 'Select a vehicle'), driverId: z.string().min(1, 'Select a driver') })

function AssignDialog({ tripIds, then }: { tripIds: string[]; then?: 'ready' | 'scheduled' | 'dispatch' }) {
  const trips = useTrips(tripIds)
  const assignable = React.useMemo(() => trips.filter((t) => isDraft(t.status)), [trips])
  const first = assignable[0]
  const { vehicleOptions, driverOptions } = useCrewOptions(first?.vehicleId, first?.driverId)
  const { closeIf, open } = useTripDialogs.getState()

  React.useEffect(() => {
    if (!assignable.length) {
      toast.error('Nothing to assign', { description: 'Only awaiting, scheduled or ready trips can be assigned a vehicle and driver.' })
      closeIf('assign')
    }
  }, [assignable.length, closeIf])
  if (!first) return null
  const multi = assignable.length > 1

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && closeIf('assign')}
      title={multi ? `Assign vehicle & driver to ${assignable.length} trips` : first.vehicleId ? `Reassign ${first.ref}` : `Assign ${first.ref}`}
      description="Only active vehicles and drivers are listed. Availability and compliance are checked as you choose."
      schema={assignSchema}
      defaultValues={{ vehicleId: first.vehicleId ?? '', driverId: first.driverId ?? '' }}
      submitLabel={then === 'dispatch' ? 'Assign & continue' : 'Assign'}
      onSubmit={(v) => {
        const blockers = assignable.flatMap((t) => blockersOf(checkAssignment({ vehicleId: v.vehicleId, driverId: v.driverId, cargoWeightKg: t.cargoWeightKg, scheduledStart: t.scheduledStart, plannedDurationMin: t.plannedDurationMin, excludeTripId: t.id, mode: 'assign' })))
        if (blockers.length) throw new Error(blockers[0]!.text)
        for (const t of assignable) assignTrip(t.id, v.vehicleId, v.driverId, then === 'dispatch' ? undefined : then)
        const reg = getById('vehicles', v.vehicleId)?.reg ?? 'vehicle'
        const name = getById('drivers', v.driverId)?.name ?? 'driver'
        toast.success(multi ? `Assigned ${assignable.length} trips` : `Assigned ${first.ref}`, { description: `${reg} · ${name}` })
        if (then === 'dispatch' && !multi) open({ kind: 'dispatch', tripId: first.id })
      }}
    >
      {(form) => (
        <div className="space-y-4">
          {multi ? (
            <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-xs">
              <p className="mb-1.5 text-[13px] font-medium">{assignable.length} trips selected</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {assignable.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex justify-between gap-2"><span className="num">{t.ref}</span><span className="truncate">{t.origin.city} → {t.destination.city}</span></li>
                ))}
                {assignable.length > 5 && <li>+ {assignable.length - 5} more</li>}
              </ul>
              {trips.length !== assignable.length && <p className="mt-1.5 text-warning">{trips.length - assignable.length} selected trip(s) are already under way or closed and will be skipped.</p>}
            </div>
          ) : (
            <TripHeaderCard trip={first} />
          )}
          <AssignFields form={form} trips={assignable} vehicleOptions={vehicleOptions} driverOptions={driverOptions} />
        </div>
      )}
    </FormDialog>
  )
}

function AssignFields({ form, trips, vehicleOptions, driverOptions }: { form: AnyForm; trips: Trip[]; vehicleOptions: import('@/components/ui/command').ComboOption[]; driverOptions: import('@/components/ui/command').ComboOption[] }) {
  const [vehicleId, driverId] = useWatch({ control: form.control, name: ['vehicleId', 'driverId'] }) as [string, string]
  React.useEffect(() => {
    const sub = form.watch((_v: unknown, info: { name?: string; type?: string }) => {
      if (info.type !== 'change' || info.name !== 'vehicleId') return
      const veh = getById('vehicles', form.getValues('vehicleId'))
      if (veh?.driverId) form.setValue('driverId', veh.driverId, { shouldDirty: true })
    })
    return () => sub.unsubscribe()
  }, [form])
  const checks = React.useMemo(() => {
    if (!vehicleId && !driverId) return []
    const seen = new Set<string>()
    const all: Check[] = []
    for (const t of trips) {
      for (const c of checkAssignment({ vehicleId, driverId, cargoWeightKg: t.cargoWeightKg, scheduledStart: t.scheduledStart, plannedDurationMin: t.plannedDurationMin, excludeTripId: t.id, mode: 'assign' })) {
        const text = trips.length > 1 && c.level !== 'ok' ? `${t.ref}: ${c.text}` : c.text
        if (!seen.has(text) && (trips.length === 1 || c.level !== 'ok' || !all.some((x) => x.level === 'ok' && x.text === c.text))) {
          seen.add(text)
          all.push({ ...c, text })
        }
      }
    }
    return all.slice(0, 12)
  }, [vehicleId, driverId, trips])
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <ComboField form={form} name="vehicleId" label="Vehicle" required options={vehicleOptions} placeholder="Select vehicle…" searchPlaceholder="Search vehicles…" />
        <ComboField form={form} name="driverId" label="Driver" required options={driverOptions} placeholder="Select driver…" searchPlaceholder="Search drivers…" />
      </div>
      {checks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="label-xs mb-2">Availability checks</div>
          <ChecksList checks={checks} />
        </div>
      )}
    </>
  )
}

/* ---------------------------------------------------------------------------------------------- *
 * Dispatch (pre-departure checklist)
 * ---------------------------------------------------------------------------------------------- */
const dispatchSchema = z.object({ acknowledged: z.boolean() })

function DispatchDialog({ tripId }: { tripId: string }) {
  const trip = useDb((s) => s.trips.find((t) => t.id === tripId))
  const tel = useLive((s) => (trip?.vehicleId ? s.telemetry[trip.vehicleId] : undefined))
  const { closeIf, open } = useTripDialogs.getState()
  const checks = React.useMemo(
    () => (trip ? checkAssignment({ vehicleId: trip.vehicleId, driverId: trip.driverId, cargoWeightKg: trip.cargoWeightKg, plannedDurationMin: trip.plannedDurationMin, routeId: trip.routeId, routeDir: trip.routeDir, excludeTripId: trip.id, mode: 'dispatch' }) : []),
    // telemetry drives the GPS / fuel / positioning checks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip, tel],
  )
  if (!trip) return null
  const blockers = blockersOf(checks)
  const warnings = warningsOf(checks)
  const reg = getById('vehicles', trip.vehicleId)?.reg ?? 'the vehicle'

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && closeIf('dispatch')}
      title={`Dispatch ${trip.ref}`}
      description="Pre-departure checks. Once dispatched, the vehicle starts driving the route and appears moving on Live Tracking."
      schema={dispatchSchema}
      defaultValues={{ acknowledged: false }}
      submitLabel="Dispatch now"
      footerExtra={blockers.length > 0 ? <Button type="button" variant="outline" onClick={() => open({ kind: 'assign', tripIds: [trip.id], then: 'dispatch' })}>Change assignment</Button> : undefined}
      onSubmit={(v) => {
        if (isActive(trip.status)) throw new Error('This trip has already been dispatched')
        if (blockers.length) throw new Error('Resolve the blocking issues before dispatching')
        if (warnings.length && !v.acknowledged) throw new Error('Please acknowledge the warnings to dispatch anyway')
        dispatchTrip(trip.id)
        toast.success(`${trip.ref} dispatched`, { description: `${reg} is now en route to ${trip.destination.city}.` })
      }}
    >
      {(form) => (
        <div className="space-y-4">
          <TripHeaderCard trip={trip} />
          <div className="rounded-lg border border-border bg-surface-2/50 p-3">
            <div className="label-xs mb-2">Checklist · {blockers.length} blocking · {warnings.length} warning{warnings.length === 1 ? '' : 's'}</div>
            <ChecksList checks={checks} />
          </div>
          {warnings.length > 0 && blockers.length === 0 && <CheckboxField form={form} name="acknowledged" label="I have reviewed the warnings and want to dispatch anyway" />}
        </div>
      )}
    </FormDialog>
  )
}

/* ---------------------------------------------------------------------------------------------- *
 * Delay
 * ---------------------------------------------------------------------------------------------- */
const delaySchema = z
  .object({
    delayMinutes: z.number({ error: 'Enter the delay in minutes' }).int('Whole minutes only').min(5, 'Minimum 5 minutes').max(2880, 'Maximum 48 hours'),
    reason: z.string().min(1, 'Choose a reason'),
    details: z.string().max(200, 'Keep details under 200 characters').optional(),
  })
  .refine((v) => v.reason !== 'Other' || !!v.details?.trim(), { path: ['details'], message: 'Describe the reason' })

function DelayDialog({ tripId }: { tripId: string }) {
  const trip = useDb((s) => s.trips.find((t) => t.id === tripId))
  const { closeIf } = useTripDialogs.getState()
  if (!trip || !isActive(trip.status)) return null
  const existing = trip.delayReason ?? ''
  const preset = DELAY_REASONS.includes(existing) ? existing : existing ? 'Other' : ''
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && closeIf('delay')}
      title={trip.status === 'delayed' ? `Update delay on ${trip.ref}` : `Report delay on ${trip.ref}`}
      description="Marks the trip as Delayed. The vehicle slows down in the simulation and the customer ETA moves back."
      schema={delaySchema}
      defaultValues={{ delayMinutes: (trip.delayMinutes || undefined) as number, reason: preset, details: preset === 'Other' ? existing : '' }}
      submitLabel={trip.status === 'delayed' ? 'Update delay' : 'Mark delayed'}
      onSubmit={(v) => {
        const reason = v.reason === 'Other' ? v.details!.trim() : v.details?.trim() ? `${v.reason} – ${v.details.trim()}` : v.reason
        delayTrip(trip.id, v.delayMinutes, reason)
        toast.warning(`${trip.ref} delayed by ${fmtDuration(v.delayMinutes)}`, { description: reason })
      }}
    >
      {(form) => (
        <div className="space-y-4">
          <TripHeaderCard trip={trip} />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField form={form} name="delayMinutes" label="Delay" required suffix="min" min={5} step={5} />
            <SelectField form={form} name="reason" label="Reason" required options={DELAY_REASONS.map((r) => ({ value: r, label: r }))} placeholder="Select reason…" />
            <TextField form={form} name="details" label="Details" placeholder="Optional — location, expected resolution…" className="sm:col-span-2" />
          </div>
          <DelayPreview form={form} trip={trip} />
        </div>
      )}
    </FormDialog>
  )
}

function DelayPreview({ form, trip }: { form: AnyForm; trip: Trip }) {
  const minutes = Number(useWatch({ control: form.control, name: 'delayMinutes' })) || 0
  const eta = new Date(trip.plannedEnd).getTime() + minutes * 6e4
  return (
    <p className="rounded-md bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
      Planned arrival {fmtDateTime(trip.plannedEnd)} → new ETA <span className="num font-medium text-foreground">{fmtDateTime(eta)}</span>
    </p>
  )
}

/* ---------------------------------------------------------------------------------------------- *
 * Complete delivery / proof of delivery
 * ---------------------------------------------------------------------------------------------- */
function buildCompleteSchema(trip: Trip) {
  const amend = trip.status === 'completed'
  const startMs = new Date(trip.actualStart ?? trip.scheduledStart).getTime()
  return z
    .object({
      receivedBy: z.string().trim().min(2, 'Enter the name of the person who received the cargo').max(80),
      signedAt: z.string().min(1, 'Enter the delivery time'),
      actualDistanceKm: z.number({ error: 'Enter the distance driven' }).min(0.1, 'Distance must be above 0').max(5000),
      conditionOk: z.boolean(),
      photoCount: z.number().int().min(0).max(20),
      delayReason: z.string().optional(),
      notes: z.string().max(500, 'Notes are limited to 500 characters').optional(),
    })
    .superRefine((v, ctx) => {
      const signed = new Date(v.signedAt).getTime()
      if (Number.isNaN(signed)) return void ctx.addIssue({ code: 'custom', path: ['signedAt'], message: 'Enter a valid date and time' })
      if (signed > Date.now() + 10 * 6e4) ctx.addIssue({ code: 'custom', path: ['signedAt'], message: 'Delivery time cannot be in the future' })
      if (!amend) {
        if (signed < startMs) ctx.addIssue({ code: 'custom', path: ['signedAt'], message: `Delivery cannot be before departure (${fmtDateTime(startMs)})` })
        const late = (signed - startMs) / 6e4 - trip.plannedDurationMin
        if (late > 30 && !v.delayReason) ctx.addIssue({ code: 'custom', path: ['delayReason'], message: `Trip ran ${fmtDuration(late)} over plan — record a reason` })
      }
      if (!v.conditionOk && !v.notes?.trim()) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Describe the damage or discrepancy' })
      if (!v.conditionOk && v.photoCount < 1) ctx.addIssue({ code: 'custom', path: ['photoCount'], message: 'Attach at least one photo of the damage' })
    })
}

function CompleteDialog({ tripId }: { tripId: string }) {
  const trip = useDb((s) => s.trips.find((t) => t.id === tripId))
  const { closeIf } = useTripDialogs.getState()
  const schema = React.useMemo(() => (trip ? buildCompleteSchema(trip) : null), [trip?.id, trip?.status])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!trip || !schema || (trip.status !== 'completed' && !isActive(trip.status))) return null
  const amend = trip.status === 'completed'
  const pod = trip.pod
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && closeIf('complete')}
      size="lg"
      title={amend ? `Update proof of delivery · ${trip.ref}` : `Complete ${trip.ref}`}
      description={amend ? 'Amend the receiver, condition, photos or notes recorded at delivery.' : 'Capture proof of delivery. The vehicle stops and the linked shipment is marked delivered.'}
      schema={schema}
      defaultValues={{
        receivedBy: pod?.receivedBy ?? getById('customers', trip.customerId)?.contactName ?? '', signedAt: toInputDateTime(pod?.signedAt ?? new Date().toISOString()), actualDistanceKm: trip.actualDistanceKm ?? trip.plannedDistanceKm,
        conditionOk: pod?.conditionOk ?? true, photoCount: pod?.photoCount ?? 0, delayReason: trip.delayReason && !amend ? trip.delayReason : '', notes: pod?.notes ?? '',
      }}
      submitLabel={amend ? 'Save POD' : 'Complete trip'}
      onSubmit={(v) => {
        const signedAt = fromInputDate(v.signedAt)
        completeTrip(trip.id, { receivedBy: v.receivedBy, signedAt, conditionOk: v.conditionOk, photoCount: v.photoCount, notes: v.notes, actualDistanceKm: v.actualDistanceKm, delayReason: v.delayReason || undefined })
        toast.success(amend ? `POD updated for ${trip.ref}` : `${trip.ref} completed`, { description: `Received by ${v.receivedBy.trim()}` })
      }}
    >
      {(form) => (
        <div className="space-y-4">
          <TripHeaderCard trip={trip} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField form={form} name="receivedBy" label="Received by" required placeholder="Full name of receiving clerk" />
            <DateField form={form} name="signedAt" label="Delivered at" required withTime />
            {!amend && <NumberField form={form} name="actualDistanceKm" label="Distance driven" required suffix="km" min={0} step={0.1} />}
            <SwitchField form={form} name="conditionOk" label="Cargo received in good condition" hint="Switch off to record damage or short delivery" className={amend ? 'sm:col-span-2' : ''} />
            <PhotoPicker form={form} />
            <CompleteOutcome form={form} trip={trip} amend={amend} />
            <TextAreaField form={form} name="notes" label="Delivery notes" rows={2} placeholder="Delivered in full, goods checked against delivery note…" className="sm:col-span-2" />
          </div>
        </div>
      )}
    </FormDialog>
  )
}

/** Shows the computed duration / delay, and asks for a delay reason when the trip ran long. */
function CompleteOutcome({ form, trip, amend }: { form: AnyForm; trip: Trip; amend: boolean }) {
  const signedAt = useWatch({ control: form.control, name: 'signedAt' }) as string
  if (amend) return null
  const startMs = new Date(trip.actualStart ?? trip.scheduledStart).getTime()
  const signed = signedAt ? new Date(signedAt).getTime() : NaN
  if (Number.isNaN(signed)) return null
  const actual = Math.max(1, Math.round((signed - startMs) / 6e4))
  const late = actual - trip.plannedDurationMin
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
        <span>Planned <span className="num font-medium text-foreground">{fmtDuration(trip.plannedDurationMin)}</span></span>
        <span>Actual <span className="num font-medium text-foreground">{fmtDuration(actual)}</span></span>
        {late > 0 ? <Badge tone={late > 30 ? 'danger' : 'warning'}>{fmtDuration(late)} late</Badge> : <Badge tone="success">On time</Badge>}
      </div>
      {late > 30 && <SelectField form={form} name="delayReason" label="Delay reason" required options={DELAY_REASONS.filter((r) => r !== 'Other').map((r) => ({ value: r, label: r }))} placeholder="Why did the trip run long?" className="sm:col-span-2" />}
    </>
  )
}

function PhotoPicker({ form }: { form: AnyForm }) {
  const count = (useWatch({ control: form.control, name: 'photoCount' }) as number) ?? 0
  const error = form.formState.errors.photoCount?.message as string | undefined
  const input = React.useRef<HTMLInputElement>(null)
  const [names, setNames] = React.useState<string[]>([])
  return (
    <Field label="Delivery photos" error={error} hint={!error ? 'Photos are counted on the POD (files are not uploaded in this demo)' : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Camera /> Attach photos
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Attach delivery photos"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            setNames(files.map((f) => f.name))
            form.setValue('photoCount', Math.min(20, files.length), { shouldDirty: true, shouldValidate: true })
          }}
        />
        <Badge tone={count > 0 ? 'primary' : 'neutral'}>{count} photo{count === 1 ? '' : 's'}</Badge>
        {count > 0 && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove photos" onClick={() => { setNames([]); if (input.current) input.current.value = ''; form.setValue('photoCount', 0, { shouldDirty: true, shouldValidate: true }) }}>
            <X />
          </Button>
        )}
      </div>
      {names.length > 0 && <p className="truncate text-xs text-muted-foreground">{names.slice(0, 3).join(', ')}{names.length > 3 && ` +${names.length - 3}`}</p>}
    </Field>
  )
}

/* ---------------------------------------------------------------------------------------------- *
 * Cancel
 * ---------------------------------------------------------------------------------------------- */
const cancelSchema = z
  .object({ reason: z.string().min(1, 'Choose a reason'), details: z.string().max(200, 'Keep details under 200 characters').optional() })
  .refine((v) => v.reason !== 'Other' || !!v.details?.trim(), { path: ['details'], message: 'Describe the reason' })

function CancelDialog({ tripIds }: { tripIds: string[] }) {
  const trips = useTrips(tripIds)
  const cancellable = React.useMemo(() => trips.filter((t) => !isTerminal(t.status)), [trips])
  const { closeIf } = useTripDialogs.getState()
  React.useEffect(() => {
    if (!cancellable.length) {
      toast.error('Nothing to cancel', { description: 'Completed and cancelled trips cannot be cancelled again.' })
      closeIf('cancel')
    }
  }, [cancellable.length, closeIf])
  if (!cancellable.length) return null
  const active = cancellable.filter((t) => isActive(t.status))
  const multi = cancellable.length > 1
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && closeIf('cancel')}
      destructive
      title={multi ? `Cancel ${cancellable.length} trips` : `Cancel ${cancellable[0]!.ref}`}
      description="Cancelled trips stay in the audit trail and can be reinstated from the board."
      schema={cancelSchema}
      defaultValues={{ reason: '', details: '' }}
      submitLabel={multi ? 'Cancel trips' : 'Cancel trip'}
      onSubmit={(v) => {
        const reason = v.reason === 'Other' ? v.details!.trim() : v.details?.trim() ? `${v.reason} – ${v.details.trim()}` : v.reason
        for (const t of cancellable) cancelTrip(t.id, reason)
        toast.success(multi ? `Cancelled ${cancellable.length} trips` : `Cancelled ${cancellable[0]!.ref}`, { description: reason })
      }}
    >
      {(form) => (
        <div className="space-y-4">
          {multi ? (
            <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-xs text-muted-foreground">
              <ul className="space-y-0.5">
                {cancellable.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex justify-between gap-2"><span className="num">{t.ref}</span><span className="truncate">{t.origin.city} → {t.destination.city}</span></li>
                ))}
                {cancellable.length > 5 && <li>+ {cancellable.length - 5} more</li>}
              </ul>
              {trips.length !== cancellable.length && <p className="mt-1.5 text-warning">{trips.length - cancellable.length} closed trip(s) are skipped.</p>}
            </div>
          ) : (
            <TripHeaderCard trip={cancellable[0]!} />
          )}
          {active.length > 0 && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {active.length === 1 ? `${active[0]!.ref} is on the road.` : `${active.length} trips are on the road.`} The vehicle stops where it is and the cargo needs a recovery plan.
            </p>
          )}
          <div className="grid gap-3">
            <SelectField form={form} name="reason" label="Reason" required options={CANCEL_REASONS.map((r) => ({ value: r, label: r }))} placeholder="Select reason…" />
            <TextField form={form} name="details" label="Details" placeholder="Optional — who requested it, reference…" />
          </div>
        </div>
      )}
    </FormDialog>
  )
}

/* ---------------------------------------------------------------------------------------------- *
 * Host: renders whichever dialog the store asks for
 * ---------------------------------------------------------------------------------------------- */
function FormHost({ tripId, defaults }: { tripId?: string; defaults?: import('./tripStore').TripFormDefaults }) {
  const trip = useDb((s) => (tripId ? s.trips.find((t) => t.id === tripId) : undefined))
  return <TripFormDialog open onOpenChange={(o) => !o && useTripDialogs.getState().closeIf('form')} trip={trip} defaults={defaults} />
}

export default function TripDialogsHost() {
  const dialog = useTripDialogs((s) => s.dialog)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'form': return <FormHost key={dialog.tripId ?? 'new'} tripId={dialog.tripId} defaults={dialog.defaults} />
    case 'assign': return <AssignDialog key={dialog.tripIds.join(',')} tripIds={dialog.tripIds} then={dialog.then} />
    case 'dispatch': return <DispatchDialog key={dialog.tripId} tripId={dialog.tripId} />
    case 'delay': return <DelayDialog key={dialog.tripId} tripId={dialog.tripId} />
    case 'complete': return <CompleteDialog key={dialog.tripId} tripId={dialog.tripId} />
    case 'cancel': return <CancelDialog key={dialog.tripIds.join(',')} tripIds={dialog.tripIds} />
  }
}

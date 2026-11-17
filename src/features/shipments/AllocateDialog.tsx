import { useEffect, useMemo } from 'react'
import { useFormState, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { Info, Route as RouteIcon, TriangleAlert } from 'lucide-react'
import type { Shipment, Trip } from '@/types'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { getById } from '@/hooks/useLookup'
import { ROUTES, ROUTE_BY_ID } from '@/data/routes'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, SelectField, TextAreaField, fromInputDate, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import type { ComboOption } from '@/components/ui/command'
import { Segmented } from '@/components/ui/segmented'
import { LIVE_STATE, PRIORITY, VEHICLE_CATEGORY } from '@/config/status'
import { fmtDateTime } from '@/lib/format'
import { advanceMilestones, estimateDurationMin, exceptionMilestones, fmtWeight, nextTripRef, reachedIndex, routeDirFor, stageMilestones, suggestRoute } from './shipmentLib'

const OPEN_TRIP: Trip['status'][] = ['awaiting_assignment', 'scheduled', 'ready']
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'].map((v) => ({ value: v, label: PRIORITY[v]!.label }))

type Mode = 'assign' | 'new' | 'link'

function makeSchema(weightKg: number) {
  return z
    .object({
      mode: z.enum(['assign', 'new', 'link']),
      vehicleId: z.string().min(1, 'Select a vehicle'),
      driverId: z.string().min(1, 'Select a driver'),
      tripId: z.string().optional(),
      routeId: z.string().optional(),
      scheduledStart: z.string().optional(),
      priority: z.string().min(1),
      notes: z.string().max(300, 'Max 300 characters').optional(),
    })
    .superRefine((v, ctx) => {
      if (v.mode === 'link' && !v.tripId) ctx.addIssue({ code: 'custom', path: ['tripId'], message: 'Select the trip to link' })
      if (v.mode === 'new') {
        if (!v.routeId) ctx.addIssue({ code: 'custom', path: ['routeId'], message: 'Select a route' })
        if (!v.scheduledStart) ctx.addIssue({ code: 'custom', path: ['scheduledStart'], message: 'Set the departure time' })
      }
      const veh = getById('vehicles', v.vehicleId)
      if (veh && veh.loadCapacityKg < weightKg) ctx.addIssue({ code: 'custom', path: ['vehicleId'], message: `Load of ${fmtWeight(weightKg)} exceeds ${veh.reg}'s ${fmtWeight(veh.loadCapacityKg)} capacity` })
    })
}

/** Vehicle & driver option lists enriched with live availability. */
const NO_TELEMETRY: Record<string, never> = {}
export function useAllocationOptions(weightKg: number, enabled = true) {
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const trips = useDb((s) => s.trips)
  const telemetry = useLive((s) => (enabled ? s.telemetry : NO_TELEMETRY)) as Record<string, import('@/types').Telemetry | undefined>
  const vehicleOptions = useMemo<ComboOption[]>(
    () =>
      vehicles
        .filter((v) => v.status === 'active' && v.category !== 'service' && v.category !== 'bus')
        .map((v) => {
          const tel = telemetry[v.id]
          const small = v.loadCapacityKg < weightKg
          const state = tel ? LIVE_STATE[tel.state].label : 'Available'
          return { value: v.id, label: v.reg, hint: small ? `${fmtWeight(v.loadCapacityKg)} cap. · too small` : `${VEHICLE_CATEGORY[v.category]} · ${fmtWeight(v.loadCapacityKg)} · ${state}`, disabled: small }
        })
        .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled) || a.label.localeCompare(b.label)),
    [vehicles, telemetry, weightKg],
  )
  const driverOptions = useMemo<ComboOption[]>(() => {
    const busy = new Set(trips.filter((t) => t.status === 'in_transit' || t.status === 'delayed').map((t) => t.driverId))
    const now = Date.now()
    return drivers
      .filter((d) => d.status === 'active')
      .map((d) => {
        const expired = new Date(d.licenceExpiry).getTime() < now
        return { value: d.id, label: d.name, hint: expired ? 'Licence expired' : `${d.empNo} · ${d.licenceClass}${busy.has(d.id) ? ' · on trip' : ''}`, disabled: expired }
      })
      .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled) || a.label.localeCompare(b.label))
  }, [drivers, trips])
  return { vehicleOptions, driverOptions }
}

/** Picks the vehicle's regular driver when the vehicle changes. */
export function VehicleDriverSync({ form }: { form: AnyForm }) {
  const vehicleId = useWatch({ control: form.control, name: 'vehicleId' }) as string
  const { dirtyFields } = useFormState({ control: form.control, name: 'vehicleId' })
  useEffect(() => {
    if (!vehicleId || !dirtyFields.vehicleId) return
    const v = getById('vehicles', vehicleId)
    const d = getById('drivers', v?.driverId)
    if (d && d.status === 'active' && new Date(d.licenceExpiry).getTime() > Date.now()) form.setValue('driverId', d.id, { shouldDirty: true, shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId])
  return null
}

function VehicleNote({ form }: { form: AnyForm }) {
  const vehicleId = useWatch({ control: form.control, name: 'vehicleId' }) as string
  const tel = useLive((s) => (vehicleId ? s.telemetry[vehicleId] : undefined))
  const veh = useDb((s) => s.vehicles.find((v) => v.id === vehicleId))
  const trip = useDb((s) => s.trips.find((t) => t.id === tel?.tripId))
  if (!veh) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" />
      <p>
        <span className="font-medium text-foreground">{veh.reg}</span> · {veh.make} {veh.model} · {fmtWeight(veh.loadCapacityKg)} capacity · fuel {Math.round(tel?.fuelPct ?? veh.fuelPct)}%
        {tel && <> · currently {LIVE_STATE[tel.state].label.toLowerCase()} near {tel.location}</>}
        {trip && <> · <span className="text-warning">on {trip.ref} until {fmtDateTime(trip.plannedEnd)}</span></>}
      </p>
    </div>
  )
}

function ModeFields({ form, shipment, linkable, vehicleOptions, driverOptions }: { form: AnyForm; shipment: Shipment; linkable: ComboOption[]; vehicleOptions: ComboOption[]; driverOptions: ComboOption[] }) {
  const mode = useWatch({ control: form.control, name: 'mode' }) as Mode
  const tripId = useWatch({ control: form.control, name: 'tripId' }) as string | undefined
  const routeId = useWatch({ control: form.control, name: 'routeId' }) as string | undefined
  const suggestion = useMemo(() => suggestRoute(shipment.pickup, shipment.delivery), [shipment.pickup, shipment.delivery])
  const routeOptions = useMemo<ComboOption[]>(
    () => [...ROUTES].sort((a, b) => Number(b.id === suggestion?.route.id) - Number(a.id === suggestion?.route.id) || a.name.localeCompare(b.name)).map((r) => ({ value: r.id, label: r.name, hint: `${r.lengthKm} km · ${r.kind === 'city' ? 'city' : 'highway'}${r.id === suggestion?.route.id ? ' · suggested' : ''}` })),
    [suggestion],
  )
  const { dirtyFields } = useFormState({ control: form.control, name: 'tripId' })
  // when linking a trip, inherit its vehicle/driver
  useEffect(() => {
    if (mode !== 'link' || !tripId || !dirtyFields.tripId) return
    const t = getById('trips', tripId)
    if (t?.vehicleId) form.setValue('vehicleId', t.vehicleId, { shouldDirty: true })
    if (t?.driverId) form.setValue('driverId', t.driverId, { shouldDirty: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])
  const route = routeId ? ROUTE_BY_ID[routeId] : undefined
  const off = suggestion && routeId === suggestion.route.id && suggestion.km > 60

  return (
    <>
      {mode !== 'assign' && (
        <Segmented
          aria-label="Allocation mode"
          size="md"
          value={mode}
          onChange={(v) => form.setValue('mode', v, { shouldDirty: true })}
          options={[{ value: 'new', label: 'Create new trip' }, { value: 'link', label: `Link existing trip${linkable.length ? ` (${linkable.length})` : ''}`, disabled: !linkable.length }]}
        />
      )}
      {mode === 'link' && <ComboField form={form} name="tripId" label="Open trip" required options={linkable} placeholder="Select a trip…" searchPlaceholder="Search trips by ref or city…" hint="Only unassigned scheduled / ready trips without a shipment are listed." />}
      <FormGrid>
        <ComboField form={form} name="vehicleId" label="Vehicle" required options={vehicleOptions} placeholder="Select vehicle…" searchPlaceholder="Search registration…" />
        <ComboField form={form} name="driverId" label="Driver" required options={driverOptions} placeholder="Select driver…" searchPlaceholder="Search drivers…" />
      </FormGrid>
      <VehicleNote form={form} />
      {mode === 'new' && (
        <>
          <ComboField form={form} name="routeId" label="Road route" required options={routeOptions} placeholder="Select route…" searchPlaceholder="Search routes…" />
          {route && (
            <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${off ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border bg-surface-2/60 text-muted-foreground'}`}>
              {off ? <TriangleAlert className="mt-px size-3.5 shrink-0" /> : <RouteIcon className="mt-px size-3.5 shrink-0" />}
              <p>
                {route.road} · {route.lengthKm} km. {off ? 'No predefined route matches this pickup/delivery pair exactly — the nearest corridor is selected.' : 'Direction of travel is set from the pickup point.'}
              </p>
            </div>
          )}
          <FormGrid>
            <DateField form={form} name="scheduledStart" label="Departure" required withTime />
            <SelectField form={form} name="priority" label="Priority" required options={PRIORITY_OPTIONS} />
          </FormGrid>
        </>
      )}
      <TextAreaField form={form} name="notes" label="Dispatch notes" rows={2} placeholder="Loading instructions, gate pass, escorts…" />
    </>
  )
}

export function AllocateDialog({ open, onOpenChange, shipment }: { open: boolean; onOpenChange: (o: boolean) => void; shipment: Shipment | undefined }) {
  const trips = useDb((s) => s.trips)
  const s = shipment
  const linkedTrip = s?.tripId ? trips.find((t) => t.id === s.tripId) : undefined
  const assignMode = !!linkedTrip && OPEN_TRIP.includes(linkedTrip.status)
  const { vehicleOptions, driverOptions } = useAllocationOptions(s?.weightKg ?? 0, open)
  const linkable = useMemo<ComboOption[]>(
    () =>
      trips
        .filter((t) => !t.shipmentId && OPEN_TRIP.includes(t.status) && t.cargoType !== 'passengers')
        .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
        .map((t) => ({ value: t.id, label: `${t.ref} · ${t.origin.city} → ${t.destination.city}`, hint: fmtDateTime(t.scheduledStart) })),
    [trips],
  )
  const schema = useMemo(() => makeSchema(s?.weightKg ?? 0), [s?.weightKg])
  const suggestion = useMemo(() => (s ? suggestRoute(s.pickup, s.delivery) : null), [s])

  const defaults = useMemo(() => {
    const start = s ? new Date(Math.max(new Date(s.pickupWindowStart).getTime(), Date.now() + 30 * 6e4)) : new Date()
    return {
      mode: (assignMode ? 'assign' : 'new') as Mode,
      vehicleId: linkedTrip?.vehicleId ?? s?.vehicleId ?? '',
      driverId: linkedTrip?.driverId ?? s?.driverId ?? '',
      tripId: '',
      routeId: suggestion?.route.id ?? '',
      scheduledStart: toInputDateTime(start.toISOString()),
      priority: 'normal',
      notes: '',
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s?.id])

  if (!s) return null
  const reassign = reachedIndex(s) >= 1

  const onSubmit = (v: z.output<typeof schema>) => {
    const db = useDb.getState()
    const vehicle = db.vehicles.find((x) => x.id === v.vehicleId)!
    const driver = db.drivers.find((x) => x.id === v.driverId)!
    const now = new Date().toISOString()
    const startSoon = (iso: string) => new Date(iso).getTime() <= Date.now() + 2 * 36e5
    let trip: Trip | undefined
    let createdTrip = false

    if (v.mode === 'assign' && linkedTrip) {
      const status = linkedTrip.status === 'awaiting_assignment' ? (startSoon(linkedTrip.scheduledStart) ? 'ready' : 'scheduled') : linkedTrip.status
      db.update('trips', linkedTrip.id, { vehicleId: vehicle.id, driverId: driver.id, status }, { action: 'assign', summary: `Assigned ${vehicle.reg} / ${driver.name} to ${linkedTrip.ref}` })
      trip = { ...linkedTrip, vehicleId: vehicle.id, driverId: driver.id, status }
    } else if (v.mode === 'link') {
      const t = db.trips.find((x) => x.id === v.tripId)
      if (!t) throw new Error('The selected trip is no longer available')
      if (t.shipmentId && t.shipmentId !== s.id) throw new Error(`${t.ref} was just linked to another shipment`)
      const status = t.status === 'awaiting_assignment' ? (startSoon(t.scheduledStart) ? 'ready' : 'scheduled') : t.status
      db.update('trips', t.id, { vehicleId: vehicle.id, driverId: driver.id, shipmentId: s.id, customerId: s.customerId, status }, { action: 'assign', summary: `Linked ${t.ref} to shipment ${s.trackingRef} with ${vehicle.reg}` })
      trip = { ...t, vehicleId: vehicle.id, driverId: driver.id, status }
    } else {
      const route = ROUTE_BY_ID[v.routeId!]
      if (!route) throw new Error('Select a valid route')
      const start = fromInputDate(v.scheduledStart!)
      const dur = estimateDurationMin(route, vehicle.category)
      trip = db.insert(
        'trips',
        {
          ref: nextTripRef(db.trips), status: startSoon(start) ? 'ready' : 'scheduled', vehicleId: vehicle.id, driverId: driver.id, customerId: s.customerId, shipmentId: s.id, branchId: vehicle.branchId,
          routeId: route.id, routeDir: routeDirFor(route, s.pickup), origin: s.pickup, destination: s.delivery, cargoType: s.cargoType, cargoDescription: s.cargoDescription, cargoWeightKg: s.weightKg,
          scheduledStart: start, actualStart: null, plannedEnd: new Date(new Date(start).getTime() + dur * 6e4).toISOString(), actualEnd: null,
          plannedDistanceKm: route.lengthKm, actualDistanceKm: null, plannedDurationMin: dur, actualDurationMin: null, delayMinutes: 0, expensesUsd: 0, revenueUsd: s.chargeUsd, pod: null,
          priority: v.priority as Trip['priority'], notes: v.notes?.trim() || undefined, createdAt: now,
        },
        { action: 'assign', summary: `Created trip for shipment ${s.trackingRef} (${vehicle.reg} / ${driver.name})` },
      )
      createdTrip = true
    }

    const note = `${vehicle.reg} · ${driver.name} · ${trip.ref}`
    const milestones =
      reachedIndex(s) === 0
        ? advanceMilestones(s, 'allocated', now, note)
        : [...stageMilestones(s).map((m) => (m.key === 'allocated' ? { ...m, note } : m)), ...exceptionMilestones(s)]
    db.update('shipments', s.id, { tripId: trip.id, vehicleId: vehicle.id, driverId: driver.id, branchId: s.branchId, status: s.status === 'registered' ? 'allocated' : s.status, milestones }, { action: 'assign', summary: `Allocated ${vehicle.reg} / ${driver.name} to shipment ${s.trackingRef}` })
    toast.success(reassign ? `Vehicle & driver updated for ${s.trackingRef}` : `${s.trackingRef} allocated to ${vehicle.reg}`, { description: createdTrip ? `New trip ${trip.ref} created and scheduled` : `Linked to ${trip.ref}` })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={reassign ? 'Change vehicle & driver' : 'Allocate vehicle & driver'}
      description={`${s.trackingRef} · ${fmtWeight(s.weightKg)} · ${s.pickup.city} → ${s.delivery.city}`}
      schema={schema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      submitLabel={assignMode ? 'Save allocation' : 'Allocate'}
      size="lg"
    >
      {(form) => (
        <>
          <VehicleDriverSync form={form} />
          {assignMode && linkedTrip && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              <p>
                Updates the vehicle and driver on the linked trip <span className="font-medium text-foreground">{linkedTrip.ref}</span> ({linkedTrip.origin.city} → {linkedTrip.destination.city}, departs {fmtDateTime(linkedTrip.scheduledStart)}).
              </p>
            </div>
          )}
          <ModeFields form={form} shipment={s} linkable={linkable} vehicleOptions={vehicleOptions} driverOptions={driverOptions} />
        </>
      )}
    </FormDialog>
  )
}

/** Allocate one vehicle & driver to several shipments at once (no trip creation). */
export function BulkAllocateDialog({ open, onOpenChange, shipments, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; shipments: Shipment[]; onDone?: () => void }) {
  const eligible = shipments.filter((s) => s.status !== 'delivered' && s.status !== 'exception' && reachedIndex(s) <= 1)
  const maxWeight = Math.max(0, ...eligible.map((s) => s.weightKg))
  const totalWeight = eligible.reduce((a, s) => a + s.weightKg, 0)
  const { vehicleOptions, driverOptions } = useAllocationOptions(maxWeight, open)
  const schema = useMemo(
    () =>
      z.object({ vehicleId: z.string().min(1, 'Select a vehicle'), driverId: z.string().min(1, 'Select a driver') }).superRefine((v, ctx) => {
        const veh = getById('vehicles', v.vehicleId)
        if (veh && veh.loadCapacityKg < totalWeight) ctx.addIssue({ code: 'custom', path: ['vehicleId'], message: `Combined load ${fmtWeight(totalWeight)} exceeds ${veh.reg}'s ${fmtWeight(veh.loadCapacityKg)} capacity` })
      }),
    [totalWeight],
  )
  const onSubmit = (v: z.output<typeof schema>) => {
    const db = useDb.getState()
    const vehicle = db.vehicles.find((x) => x.id === v.vehicleId)!
    const driver = db.drivers.find((x) => x.id === v.driverId)!
    const now = new Date().toISOString()
    for (const s of eligible) {
      const trip = s.tripId ? db.trips.find((t) => t.id === s.tripId) : undefined
      if (trip && OPEN_TRIP.includes(trip.status)) db.update('trips', trip.id, { vehicleId: vehicle.id, driverId: driver.id, status: trip.status === 'awaiting_assignment' ? 'scheduled' : trip.status }, { silent: true })
      const note = `${vehicle.reg} · ${driver.name}${trip ? ` · ${trip.ref}` : ''}`
      const milestones = reachedIndex(s) === 0 ? advanceMilestones(s, 'allocated', now, note) : [...stageMilestones(s).map((m) => (m.key === 'allocated' ? { ...m, note } : m)), ...exceptionMilestones(s)]
      db.update('shipments', s.id, { vehicleId: vehicle.id, driverId: driver.id, status: 'allocated', milestones }, { silent: true })
    }
    db.updateMany('shipments', eligible.map((s) => s.id), {}, { action: 'assign', summary: `Bulk allocated ${eligible.length} shipments to ${vehicle.reg} / ${driver.name}` })
    toast.success(`${eligible.length} shipment${eligible.length === 1 ? '' : 's'} allocated to ${vehicle.reg}`, { description: shipments.length > eligible.length ? `${shipments.length - eligible.length} skipped (already moving or delivered)` : undefined })
    onDone?.()
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk allocate vehicle & driver"
      description={`${eligible.length} of ${shipments.length} selected shipment${shipments.length === 1 ? '' : 's'} can be allocated · combined load ${fmtWeight(totalWeight)}`}
      schema={schema}
      defaultValues={{ vehicleId: '', driverId: '' }}
      onSubmit={onSubmit}
      submitLabel={`Allocate ${eligible.length}`}
      size="md"
    >
      {(form) => (
        <>
          <VehicleDriverSync form={form} />
          {eligible.length === 0 && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">None of the selected shipments are eligible — only registered / allocated shipments without an open exception can be allocated.</p>}
          <ComboField form={form} name="vehicleId" label="Vehicle" required options={vehicleOptions} placeholder="Select vehicle…" searchPlaceholder="Search registration…" />
          <ComboField form={form} name="driverId" label="Driver" required options={driverOptions} placeholder="Select driver…" searchPlaceholder="Search drivers…" />
          <VehicleNote form={form} />
          <p className="text-xs text-subtle-foreground">Sets the vehicle and driver on each shipment (and on any open linked trip). Create or link individual trips from each shipment's page.</p>
        </>
      )}
    </FormDialog>
  )
}

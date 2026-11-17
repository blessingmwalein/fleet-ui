import * as React from 'react'
import { useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { ArrowRight, Lock, Route as RouteIcon } from 'lucide-react'
import type { CargoType, Trip } from '@/types'
import { ROUTES, ROUTE_BY_ID } from '@/data/routes'
import { useUi } from '@/store/ui'
import { getById } from '@/hooks/useLookup'
import { useBranchScope } from '@/hooks/useFilters'
import { useBranchOptions, useCustomerOptions } from '@/hooks/useOptions'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, FormSection, NumberField, SelectField, TextAreaField, TextField, fromInputDate, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import type { ComboOption } from '@/components/ui/command'
import { Badge } from '@/components/ui/display'
import { Progress } from '@/components/ui/form-controls'
import { CARGO_TYPE, PRIORITY, TRIP_STATUS } from '@/config/status'
import { fmtDateTime, fmtDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  blockersOf, checkAssignment, createTrip, defaultDurationMin, deriveStatus, routeDistanceKm, routePlaces, suggestRevenueUsd, updateTrip, type TripDraft,
} from './tripLogic'
import type { TripFormDefaults } from './tripStore'
import { ChecksList, useCrewOptions } from './tripUi'

const CARGO_KEYS = ['general', 'fuel', 'perishable', 'bulk', 'passengers', 'containers', 'hazardous', 'equipment'] as const
const PRIORITY_KEYS = ['low', 'normal', 'high', 'urgent'] as const

const num = (label: string) => z.number({ error: `Enter ${label}` })

function buildSchema(isEdit: boolean) {
  return z
    .object({
      customerId: z.string().optional(),
      routeId: z.string().min(1, 'Select a route'),
      direction: z.enum(['1', '-1']),
      originName: z.string().trim().min(2, 'Enter the pickup point'),
      destinationName: z.string().trim().min(2, 'Enter the delivery point'),
      cargoType: z.enum(CARGO_KEYS),
      cargoDescription: z.string().trim().min(3, 'Describe the cargo (min 3 characters)').max(120, 'Keep the description under 120 characters'),
      cargoWeightKg: num('the cargo weight').min(1, 'Weight must be above 0 kg').max(80000, 'Weight cannot exceed 80,000 kg'),
      scheduledStart: z.string().min(1, 'Pick a start date and time'),
      plannedDistanceKm: num('the distance').min(0.5, 'Distance must be at least 0.5 km').max(3000, 'Distance cannot exceed 3,000 km'),
      plannedDurationMin: num('the duration').int('Whole minutes only').min(5, 'Minimum 5 minutes').max(7200, 'Maximum 5 days'),
      priority: z.enum(PRIORITY_KEYS),
      vehicleId: z.string().optional(),
      driverId: z.string().optional(),
      branchId: z.string().min(1, 'Select the dispatching branch'),
      revenueUsd: num('the quoted revenue').min(0, 'Revenue cannot be negative').max(1_000_000, 'Revenue looks too high'),
      notes: z.string().max(500, 'Notes are limited to 500 characters').optional(),
    })
    .superRefine((v, ctx) => {
      if (!isEdit && v.scheduledStart && new Date(v.scheduledStart).getTime() < Date.now() - 24 * 36e5)
        ctx.addIssue({ code: 'custom', path: ['scheduledStart'], message: 'Start cannot be more than 24 hours in the past' })
    })
}

type Schema = ReturnType<typeof buildSchema>
export type TripFormInput = z.input<Schema>

const LOCKED_STATUSES = ['in_transit', 'delayed', 'completed']

function initialValues(trip: Trip | undefined, d: TripFormDefaults | undefined, branchId: string): TripFormInput {
  if (trip) {
    return {
      customerId: trip.customerId ?? '', routeId: trip.routeId, direction: String(trip.routeDir) as '1' | '-1', originName: trip.origin.name, destinationName: trip.destination.name,
      cargoType: trip.cargoType, cargoDescription: trip.cargoDescription, cargoWeightKg: trip.cargoWeightKg, scheduledStart: toInputDateTime(trip.scheduledStart),
      plannedDistanceKm: trip.plannedDistanceKm, plannedDurationMin: trip.plannedDurationMin, priority: trip.priority, vehicleId: trip.vehicleId ?? '', driverId: trip.driverId ?? '',
      branchId: trip.branchId, revenueUsd: trip.revenueUsd, notes: trip.notes ?? '',
    }
  }
  const route = d?.routeId ? ROUTE_BY_ID[d.routeId] : undefined
  const vehicle = d?.vehicleId ? getById('vehicles', d.vehicleId) : undefined
  const customer = d?.customerId ? getById('customers', d.customerId) : undefined
  const places = route ? routePlaces(route, 1, customer) : null
  const start = new Date(Math.ceil((Date.now() + 2 * 36e5) / 18e5) * 18e5).toISOString()
  return {
    customerId: d?.customerId ?? '', routeId: d?.routeId ?? '', direction: '1', originName: places?.origin.name ?? '', destinationName: places?.destination.name ?? '',
    cargoType: d?.cargoType ?? 'general', cargoDescription: d?.cargoDescription ?? '', cargoWeightKg: d?.cargoWeightKg as number, scheduledStart: toInputDateTime(d?.scheduledStart ?? start),
    plannedDistanceKm: route ? routeDistanceKm(route) : (undefined as unknown as number), plannedDurationMin: route ? defaultDurationMin(route, vehicle?.category) : (undefined as unknown as number),
    priority: d?.priority ?? 'normal', vehicleId: d?.vehicleId ?? '', driverId: d?.driverId ?? vehicle?.driverId ?? '', branchId: vehicle?.branchId ?? branchId,
    revenueUsd: route ? suggestRevenueUsd(route, vehicle?.category) : (undefined as unknown as number), notes: d?.notes ?? '',
  }
}

/** Create / edit trip dialog. Reusable from any module: `<TripFormDialog open onOpenChange trip? defaults? />`. */
export function TripFormDialog({ open, onOpenChange, trip, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; trip?: Trip; defaults?: TripFormDefaults }) {
  const { branchId: scopeBranch } = useBranchScope()
  const isEdit = !!trip
  const schema = React.useMemo(() => buildSchema(isEdit), [isEdit])
  const locked = !!trip && LOCKED_STATUSES.includes(trip.status)
  const defaultValues = React.useMemo(
    () => initialValues(trip, defaults, scopeBranch === 'all' ? 'br-hre' : scopeBranch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.id, defaults, open, scopeBranch],
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={trip ? `Edit trip ${trip.ref}` : 'New trip'}
      description={trip ? 'Update the route, cargo, schedule and crew. Changes are written to the audit log.' : 'Pick a route, describe the cargo and optionally assign a vehicle and driver now.'}
      schema={schema}
      defaultValues={defaultValues}
      submitLabel={trip ? 'Save changes' : 'Create trip'}
      onSubmit={(v) => {
        const route = ROUTE_BY_ID[v.routeId]
        if (!route) throw new Error('Select a valid route')
        const dir = Number(v.direction) as 1 | -1
        const places = routePlaces(route, dir, v.customerId ? getById('customers', v.customerId) : null)
        const draft: TripDraft = {
          customerId: v.customerId || null, routeId: v.routeId, routeDir: dir, origin: { ...places.origin, name: v.originName }, destination: { ...places.destination, name: v.destinationName },
          cargoType: v.cargoType as CargoType, cargoDescription: v.cargoDescription, cargoWeightKg: v.cargoWeightKg, scheduledStart: fromInputDate(v.scheduledStart),
          plannedDistanceKm: v.plannedDistanceKm, plannedDurationMin: v.plannedDurationMin, priority: v.priority, vehicleId: v.vehicleId || null, driverId: v.driverId || null,
          branchId: v.branchId, revenueUsd: v.revenueUsd, notes: v.notes?.trim() || undefined,
        }
        if (!locked) {
          const blockers = blockersOf(checkAssignment({ vehicleId: draft.vehicleId, driverId: draft.driverId, cargoWeightKg: draft.cargoWeightKg, scheduledStart: draft.scheduledStart, plannedDurationMin: draft.plannedDurationMin, excludeTripId: trip?.id, mode: 'assign' }))
          if (blockers.length) throw new Error(blockers[0]!.text)
        }
        if (trip) {
          updateTrip(trip.id, draft, locked)
          toast.success(`Updated ${trip.ref}`)
        } else {
          const t = createTrip(draft)
          toast.success(`Created ${t.ref}`, {
            description: `${t.origin.city} → ${t.destination.city} · ${TRIP_STATUS[t.status].label}`,
            action: { label: 'View', onClick: () => useUi.getState().openTrip(t.id) },
          })
        }
      }}
    >
      {(form) => <TripFormBody form={form} trip={trip} locked={locked} />}
    </FormDialog>
  )
}

function TripFormBody({ form, trip, locked }: { form: AnyForm; trip?: Trip; locked: boolean }) {
  const customers = useCustomerOptions()
  const branches = useBranchOptions()
  const { vehicleOptions, driverOptions } = useCrewOptions(trip?.vehicleId, trip?.driverId)
  const routeOptions = React.useMemo<ComboOption[]>(() => ROUTES.map((r) => ({ value: r.id, label: r.name, hint: `${routeDistanceKm(r)} km` })), [])
  const auto = React.useRef({ duration: 0, revenue: 0 })
  const routeId = useWatch({ control: form.control, name: 'routeId' }) as string
  const route = routeId ? ROUTE_BY_ID[routeId] : undefined
  const directionOptions = route
    ? [
        { value: '1', label: `${route.originName} → ${route.destName}` },
        { value: '-1', label: `${route.destName} → ${route.originName}` },
      ]
    : []

  // User-driven autofill (type === 'change' so programmatic resets/setValue never retrigger it).
  React.useEffect(() => {
    const sub = form.watch((_values: unknown, info: { name?: string; type?: string }) => {
      if (info.type !== 'change' || !info.name) return
      const v = form.getValues()
      const vehicle = v.vehicleId ? getById('vehicles', v.vehicleId) : undefined
      if (info.name === 'vehicleId' && vehicle) {
        if (vehicle.driverId) form.setValue('driverId', vehicle.driverId, { shouldDirty: true })
        form.setValue('branchId', vehicle.branchId, { shouldDirty: true })
      }
      const r = v.routeId ? ROUTE_BY_ID[v.routeId as string] : undefined
      if (!r) return
      if (['routeId', 'direction', 'customerId'].includes(info.name)) {
        const places = routePlaces(r, Number(v.direction) as 1 | -1, v.customerId ? getById('customers', v.customerId) : null)
        form.setValue('originName', places.origin.name, { shouldDirty: true })
        form.setValue('destinationName', places.destination.name, { shouldDirty: true })
      }
      if (info.name === 'routeId' || info.name === 'vehicleId') {
        form.setValue('plannedDistanceKm', routeDistanceKm(r), { shouldDirty: true })
        const dur = defaultDurationMin(r, vehicle?.category)
        if (!v.plannedDurationMin || v.plannedDurationMin === auto.current.duration || info.name === 'routeId') {
          form.setValue('plannedDurationMin', dur, { shouldDirty: true })
          auto.current.duration = dur
        }
        const rev = suggestRevenueUsd(r, vehicle?.category)
        if (!v.revenueUsd || v.revenueUsd === auto.current.revenue || info.name === 'routeId') {
          form.setValue('revenueUsd', rev, { shouldDirty: true })
          auto.current.revenue = rev
        }
      }
    })
    return () => sub.unsubscribe()
  }, [form])

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5">
        {locked && trip && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>This trip is {TRIP_STATUS[trip.status].label.toLowerCase()}. Route, schedule and crew are locked — you can still amend cargo, priority, revenue and notes.</span>
          </div>
        )}
        <FormSection title="Route & customer" description="Picking a route fills the places, distance and duration">
          <FormGrid>
            <ComboField form={form} name="routeId" label="Route" required options={routeOptions} placeholder="Select a route…" searchPlaceholder="Search routes…" disabled={locked} className="sm:col-span-2" />
            <SelectField form={form} name="direction" label="Direction" required options={directionOptions} placeholder="Select a route first" disabled={locked || !route} />
            <ComboField form={form} name="customerId" label="Customer" options={customers} placeholder="Select customer…" searchPlaceholder="Search customers…" clearable />
            <TextField form={form} name="originName" label="Pickup point" required disabled={locked} />
            <TextField form={form} name="destinationName" label="Delivery point" required disabled={locked} />
            <NumberField form={form} name="plannedDistanceKm" label="Planned distance" required suffix="km" min={0} step={0.1} disabled={locked} />
            <NumberField form={form} name="plannedDurationMin" label="Planned duration" required suffix="min" min={0} step={1} disabled={locked} />
          </FormGrid>
        </FormSection>
        <FormSection title="Cargo">
          <FormGrid>
            <SelectField form={form} name="cargoType" label="Cargo type" required options={Object.entries(CARGO_TYPE).map(([value, label]) => ({ value, label }))} />
            <NumberField form={form} name="cargoWeightKg" label="Weight" required suffix="kg" min={0} step={10} />
            <TextField form={form} name="cargoDescription" label="Description" required placeholder="e.g. Palletised beverages, 24 pallets" className="sm:col-span-2" />
          </FormGrid>
        </FormSection>
        <FormSection title="Schedule & priority">
          <FormGrid>
            <DateField form={form} name="scheduledStart" label="Scheduled start" required withTime disabled={locked} />
            <SelectField form={form} name="priority" label="Priority" required options={PRIORITY_KEYS.map((p) => ({ value: p, label: PRIORITY[p]!.label }))} />
          </FormGrid>
        </FormSection>
        <FormSection title="Vehicle & driver" description="Optional — leave empty to queue the trip for assignment">
          <FormGrid>
            <ComboField form={form} name="vehicleId" label="Vehicle" options={vehicleOptions} placeholder="Unassigned" searchPlaceholder="Search vehicles…" clearable disabled={locked} />
            <ComboField form={form} name="driverId" label="Driver" options={driverOptions} placeholder="Unassigned" searchPlaceholder="Search drivers…" clearable disabled={locked} />
            <SelectField form={form} name="branchId" label="Dispatching branch" required options={branches.map((b) => ({ value: b.value, label: b.label }))} disabled={locked} />
          </FormGrid>
        </FormSection>
        <FormSection title="Commercials & notes">
          <FormGrid>
            <NumberField form={form} name="revenueUsd" label="Quoted revenue" required suffix="USD" min={0} step={5} hint="Suggested from route distance and vehicle class" />
            <TextAreaField form={form} name="notes" label="Notes" rows={2} placeholder="Delivery instructions, gate codes, contact on site…" className="sm:col-span-2" />
          </FormGrid>
        </FormSection>
      </div>
      <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <TripFormSummary form={form} trip={trip} locked={locked} />
      </aside>
    </div>
  )
}

function TripFormSummary({ form, trip, locked }: { form: AnyForm; trip?: Trip; locked: boolean }) {
  const v = useWatch({ control: form.control }) as Partial<TripFormInput>
  const route = v.routeId ? ROUTE_BY_ID[v.routeId] : undefined
  const vehicle = v.vehicleId ? getById('vehicles', v.vehicleId) : undefined
  const startIso = v.scheduledStart ? fromInputDate(v.scheduledStart) : ''
  const validStart = startIso && !Number.isNaN(new Date(startIso).getTime())
  const dir = v.direction === '-1' ? -1 : 1
  const duration = Number(v.plannedDurationMin) || 0
  const endMs = validStart ? new Date(startIso).getTime() + duration * 6e4 : 0
  const checks = React.useMemo(
    () =>
      v.vehicleId || v.driverId
        ? checkAssignment({ vehicleId: v.vehicleId || null, driverId: v.driverId || null, cargoWeightKg: Number(v.cargoWeightKg) || 0, scheduledStart: validStart ? startIso : undefined, plannedDurationMin: duration, excludeTripId: trip?.id, mode: 'assign' })
        : [],
    [v.vehicleId, v.driverId, v.cargoWeightKg, startIso, validStart, duration, trip?.id],
  )
  const status = validStart ? deriveStatus(v.vehicleId, v.driverId, startIso) : 'awaiting_assignment'
  const weight = Number(v.cargoWeightKg) || 0
  const loadPct = vehicle && weight ? Math.min(150, (weight / vehicle.loadCapacityKg) * 100) : 0

  return (
    <>
      <div className="rounded-lg border border-border bg-surface-2/50 p-3">
        <div className="label-xs mb-2 flex items-center gap-1.5"><RouteIcon className="size-3.5" /> Route summary</div>
        {route ? (
          <div className="space-y-1.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-1.5 font-medium">
              {dir === 1 ? route.originName : route.destName} <ArrowRight className="size-3.5 text-muted-foreground" /> {dir === 1 ? route.destName : route.originName}
            </div>
            <p className="text-xs text-muted-foreground">{route.name} · {route.road}</p>
            <dl className="grid grid-cols-2 gap-2 pt-1 text-xs">
              <div><dt className="label-xs">Distance</dt><dd className="num text-[13px]">{Number(v.plannedDistanceKm) || routeDistanceKm(route)} km</dd></div>
              <div><dt className="label-xs">Duration</dt><dd className="num text-[13px]">{fmtDuration(duration)}</dd></div>
              <div className="col-span-2"><dt className="label-xs">Planned arrival</dt><dd className="num text-[13px]">{endMs ? fmtDateTime(endMs) : '—'}</dd></div>
            </dl>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Select a route to preview distance, duration and arrival time.</p>
        )}
      </div>
      <div className="rounded-lg border border-border bg-surface-2/50 p-3">
        <div className="label-xs mb-2">Status on save</div>
        <Badge tone={locked && trip ? TRIP_STATUS[trip.status].tone : TRIP_STATUS[status].tone}>{locked && trip ? TRIP_STATUS[trip.status].label : TRIP_STATUS[status].label}</Badge>
        {!locked && <p className="mt-1.5 text-xs text-muted-foreground">{status === 'awaiting_assignment' ? 'A vehicle and a driver are needed to schedule this trip.' : status === 'ready' ? 'Starts within 4 hours — it will appear as Ready for dispatch.' : 'It will appear in the Scheduled column.'}</p>}
      </div>
      {vehicle && weight > 0 && (
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="label-xs mb-2">Load factor</div>
          <Progress value={Math.min(100, loadPct)} indicatorClassName={cn(loadPct > 100 ? 'bg-danger' : loadPct > 90 ? 'bg-warning' : undefined)} />
          <p className="num mt-1.5 text-xs text-muted-foreground">{weight.toLocaleString('en-US')} / {vehicle.loadCapacityKg.toLocaleString('en-US')} kg · {Math.round(loadPct)}%</p>
        </div>
      )}
      {!locked && checks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="label-xs mb-2">Availability checks</div>
          <ChecksList checks={checks} />
        </div>
      )}
    </>
  )
}

import { useEffect, useMemo } from 'react'
import { addDays, format } from 'date-fns'
import { useFieldArray, useWatch } from 'react-hook-form'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { z } from 'zod'
import type { WorkOrder, WorkOrderType } from '@/types'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useById } from '@/hooks/useLookup'
import { useProviderOptions, useVehicleOptions } from '@/hooks/useOptions'
import { useMoney } from '@/hooks/useMoney'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, FormSection, NumberField, SelectField, SwitchField, TextAreaField, TextField, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import { Combobox } from '@/components/ui/command'
import { Checkbox } from '@/components/ui/form-controls'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtNumber } from '@/lib/format'
import { completeWorkOrder, createWorkOrder, rejectWorkOrder, cancelWorkOrder, saveWorkOrderProgress, scheduleWorkOrder, startWorkOrder, updateWorkOrderDetails } from '../lib/actions'
import {
  HOUR, WO_PRIORITIES, WO_PRIORITY_OPTIONS, WO_TYPES, WO_TYPE_OPTIONS, defaultProviderId, isOpen, linkedScheduleId, localDateToIso, todayLocal, toLocalDate, useOdometers,
} from '../lib/maintenance'

// ---------------------------------------------------------------------------
// Request / edit work order
// ---------------------------------------------------------------------------
export interface WoDefaults {
  vehicleId?: string
  type?: WorkOrderType
  title?: string
  description?: string
  priority?: WorkOrder['priority']
  providerId?: string
  /** yyyy-MM-dd */
  date?: string
  /** hidden link markers, e.g. [sch:sch-0001] */
  notes?: string
  scheduleNow?: boolean
}

function makeWoSchema(editing: boolean) {
  const today = todayLocal()
  return z
    .object({
      vehicleId: z.string().min(1, 'Select a vehicle'),
      type: z.enum(WO_TYPES),
      priority: z.enum(WO_PRIORITIES),
      title: z.string().trim().min(3, 'Enter a short title (min. 3 characters)').max(80, 'Keep the title under 80 characters'),
      description: z.string().trim().max(600, 'Max. 600 characters').optional(),
      providerId: z.string().min(1, 'Select a service provider'),
      technician: z.string().trim().max(60, 'Max. 60 characters').optional(),
      date: z.string().min(1, 'Choose a date'),
      scheduleNow: z.boolean(),
    })
    .refine((v) => editing || v.date >= today, { path: ['date'], message: 'The date cannot be in the past' })
}

function VehicleContext({ form }: { form: AnyForm }) {
  const vehicleId = useWatch({ control: form.control, name: 'vehicleId' }) as string
  const getVehicle = useById('vehicles')
  const workOrders = useDb((s) => s.workOrders)
  const odometers = useOdometers()
  const v = getVehicle(vehicleId)
  if (!v) return null
  const open = workOrders.filter((w) => w.vehicleId === v.id && isOpen(w))
  return (
    <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-2/50 px-2.5 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{v.make} {v.model} {v.year}</span>
      <span className="num">{fmtNumber(odometers.get(v.id) ?? v.odometerKm)} km</span>
      <span className="capitalize">{v.status.replace('_', ' ')}</span>
      {open.length > 0 && <span className="text-warning">{open.length} open work order{open.length > 1 ? 's' : ''}: {open.slice(0, 2).map((w) => w.woNo).join(', ')}</span>}
    </div>
  )
}

export function WorkOrderFormDialog({ open, onOpenChange, wo, defaults, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; wo?: WorkOrder | null; defaults?: WoDefaults; onCreated?: (wo: WorkOrder) => void }) {
  const editing = !!wo
  const vehicleOptions = useVehicleOptions()
  const providerOptions = useProviderOptions()
  const branches = useDb((s) => s.branches)
  const providers = useDb((s) => s.providers)
  const vehicles = useDb((s) => s.vehicles)
  const canApprove = useCan('maintenance.approve')
  const schema = useMemo(() => makeWoSchema(editing), [editing])

  const defaultValues = useMemo<z.input<ReturnType<typeof makeWoSchema>>>(() => {
    if (wo) {
      return { vehicleId: wo.vehicleId, type: wo.type, priority: wo.priority, title: wo.title, description: wo.description, providerId: wo.providerId, technician: wo.technician, date: toLocalDate(wo.scheduledDate), scheduleNow: false }
    }
    const veh = vehicles.find((v) => v.id === defaults?.vehicleId)
    return {
      vehicleId: defaults?.vehicleId ?? '',
      type: defaults?.type ?? 'corrective',
      priority: defaults?.priority ?? 'medium',
      title: defaults?.title ?? '',
      description: defaults?.description ?? '',
      providerId: defaults?.providerId ?? defaultProviderId(veh, branches, providers),
      technician: '',
      date: defaults?.date ?? format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      scheduleNow: !!defaults?.scheduleNow && canApprove,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, defaults, open])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${wo.woNo}` : 'Request maintenance'}
      description={editing ? 'Update the job details. Status changes are made from the work order actions.' : 'Raise a work order. Requests are reviewed and approved by the workshop / fleet manager.'}
      schema={schema}
      defaultValues={defaultValues}
      submitLabel={editing ? 'Save changes' : 'Submit request'}
      onSubmit={(v) => {
        if (wo) {
          updateWorkOrderDetails(wo, { type: v.type, priority: v.priority, title: v.title, description: v.description ?? '', providerId: v.providerId, technician: v.technician ?? '', scheduledDate: localDateToIso(v.date) })
        } else {
          const created = createWorkOrder({
            vehicleId: v.vehicleId, type: v.type, title: v.title, description: v.description, priority: v.priority, providerId: v.providerId, technician: v.technician,
            scheduledDate: localDateToIso(v.date), status: v.scheduleNow && canApprove ? 'scheduled' : 'requested', notes: defaults?.notes,
          })
          onCreated?.(created)
        }
      }}
    >
      {(form) => (
        <>
          <ComboField form={form} name="vehicleId" label="Vehicle" required options={vehicleOptions} placeholder="Select vehicle…" searchPlaceholder="Search registration or model…" disabled={editing} />
          <VehicleContext form={form} />
          <FormGrid>
            <SelectField form={form} name="type" label="Work type" required options={WO_TYPE_OPTIONS} />
            <SelectField form={form} name="priority" label="Priority" required options={WO_PRIORITY_OPTIONS} />
          </FormGrid>
          <TextField form={form} name="title" label="Title" required placeholder="e.g. Brake system repair" />
          <TextAreaField form={form} name="description" label="Fault / scope description" placeholder="Describe the fault, symptoms reported by the driver, or the scope of work…" rows={3} />
          <FormGrid>
            <ComboField form={form} name="providerId" label="Service provider" required options={providerOptions} placeholder="Select provider…" />
            <TextField form={form} name="technician" label="Technician" placeholder="Assign later" />
          </FormGrid>
          <DateField form={form} name="date" label={editing ? 'Scheduled date' : 'Preferred date'} required />
          {!editing && canApprove && <SwitchField form={form} name="scheduleNow" label="Schedule immediately" hint="Skip the approval step — the work order is created as Scheduled." />}
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Schedule / reschedule
// ---------------------------------------------------------------------------
const scheduleSchema = z.object({
  date: z.string().min(1, 'Choose a date').refine((v) => v >= todayLocal(), 'The date cannot be in the past'),
  providerId: z.string().min(1, 'Select a service provider'),
  technician: z.string().trim().max(60, 'Max. 60 characters').optional(),
})

export function ScheduleWorkOrderDialog({ open, onOpenChange, wo }: { open: boolean; onOpenChange: (o: boolean) => void; wo?: WorkOrder }) {
  const providerOptions = useProviderOptions()
  const resched = wo?.status === 'scheduled'
  const planned = wo ? toLocalDate(wo.scheduledDate) : ''
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={resched ? `Reschedule ${wo?.woNo ?? ''}` : `Schedule ${wo?.woNo ?? ''}`}
      description={wo ? `${wo.title} — book the workshop slot and assign a technician.` : undefined}
      schema={scheduleSchema}
      defaultValues={{ date: planned >= todayLocal() ? planned : format(addDays(new Date(), 1), 'yyyy-MM-dd'), providerId: wo?.providerId ?? '', technician: wo?.technician ?? '' }}
      submitLabel={resched ? 'Reschedule' : 'Schedule'}
      onSubmit={(v) => wo && scheduleWorkOrder(wo, { scheduledDate: localDateToIso(v.date), providerId: v.providerId, technician: v.technician })}
    >
      {(form) => (
        <>
          <DateField form={form} name="date" label="Scheduled date" required />
          <ComboField form={form} name="providerId" label="Service provider" required options={providerOptions} placeholder="Select provider…" />
          <TextField form={form} name="technician" label="Technician" placeholder="e.g. Learnmore Hove" />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Start work
// ---------------------------------------------------------------------------
export function StartWorkOrderDialog({ open, onOpenChange, wo }: { open: boolean; onOpenChange: (o: boolean) => void; wo?: WorkOrder }) {
  const trips = useDb((s) => s.trips)
  const getVehicle = useById('vehicles')
  const odometers = useOdometers()
  const veh = getVehicle(wo?.vehicleId)
  const odo = wo ? Math.round(odometers.get(wo.vehicleId) ?? veh?.odometerKm ?? wo.odometerKm) : 0
  const activeTrip = wo ? trips.find((t) => t.vehicleId === wo.vehicleId && (t.status === 'in_transit' || t.status === 'delayed')) : undefined
  const schema = useMemo(
    () => z.object({
      technician: z.string().trim().min(2, 'Assign a technician').max(60, 'Max. 60 characters'),
      odometerKm: z.number({ error: 'Enter the odometer reading' }).min(0, 'Must be positive'),
      note: z.string().trim().max(300, 'Max. 300 characters').optional(),
    }),
    [],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Start ${wo?.woNo ?? 'work order'}`}
      description={veh ? `${veh.reg} will be moved to “In maintenance” and parked at the workshop until the job is completed.` : undefined}
      schema={schema}
      defaultValues={{ technician: wo?.technician ?? '', odometerKm: odo, note: '' }}
      submitLabel="Start work"
      onSubmit={(v) => wo && startWorkOrder(wo, { technician: v.technician, odometerKm: v.odometerKm, note: v.note })}
    >
      {(form) => (
        <>
          {activeTrip && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{veh?.reg} is currently on trip <strong>{activeTrip.ref}</strong> ({activeTrip.origin.city} → {activeTrip.destination.city}). Starting work takes it off the road — consider reassigning the trip first.</span>
            </div>
          )}
          <TextField form={form} name="technician" label="Technician in charge" required placeholder="e.g. Learnmore Hove" />
          <NumberField form={form} name="odometerKm" label="Odometer at intake" required suffix="km" min={0} hint={veh ? `Last known reading: ${fmtNumber(odo)} km` : undefined} />
          <TextAreaField form={form} name="note" label="Intake note" placeholder="Condition on arrival, driver comments…" rows={2} />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Reject / cancel (reason required)
// ---------------------------------------------------------------------------
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a short reason (min. 5 characters)').max(300, 'Max. 300 characters') })

export function ReasonDialog({ open, onOpenChange, wo, mode }: { open: boolean; onOpenChange: (o: boolean) => void; wo?: WorkOrder; mode: 'reject' | 'cancel' }) {
  const reject = mode === 'reject'
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={reject ? `Reject request ${wo?.woNo ?? ''}` : `Cancel ${wo?.woNo ?? 'work order'}`}
      description={reject ? 'The requester will see the reason on the work order.' : wo?.status === 'in_progress' ? 'The vehicle will be released from the workshop.' : 'The work order is kept for the audit trail.'}
      schema={reasonSchema}
      defaultValues={{ reason: '' }}
      submitLabel={reject ? 'Reject request' : 'Cancel work order'}
      destructive
      size="sm"
      onSubmit={(v) => wo && (reject ? rejectWorkOrder(wo, v.reason) : cancelWorkOrder(wo, v.reason))}
    >
      {(form) => <TextAreaField form={form} name="reason" label="Reason" required rows={3} placeholder={reject ? 'e.g. Duplicate of WO-24012 / not covered by policy' : 'e.g. Vehicle sold / repair no longer required'} />}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Complete / update parts & costs
// ---------------------------------------------------------------------------
function makeCompleteSchema(mode: 'complete' | 'progress', intakeKm: number) {
  return z
    .object({
      completedAt: z.string().optional(),
      odometerKm: z.number({ error: 'Enter the odometer reading' }).min(0, 'Must be positive'),
      labourHours: z.number().min(0, 'Must be positive').max(500, 'Too many hours').optional(),
      labourCostUsd: z.number({ error: 'Enter labour cost (0 if none)' }).min(0, 'Must be positive').max(100000, 'Unrealistically high'),
      downtimeHours: z.number({ error: 'Enter downtime hours' }).min(0, 'Must be positive').max(2000, 'Unrealistically high'),
      parts: z.array(
        z.object({
          name: z.string().trim().min(1, 'Part name required').max(80),
          partNo: z.string().trim().max(30, 'Max. 30 characters').optional(),
          qty: z.number({ error: 'Qty' }).int('Whole number').min(1, 'Min. 1').max(500),
          unitCostUsd: z.number({ error: 'Unit cost' }).min(0, 'Must be positive').max(100000),
        }),
      ),
      serviceIds: z.array(z.string()),
      createFollowUp: z.boolean(),
      followUpTask: z.string().trim().max(80).optional(),
      followUpKm: z.number().int().positive('Must be positive').optional(),
      followUpDays: z.number().int().positive('Must be positive').optional(),
      followUpCost: z.number().min(0).optional(),
      notes: z.string().trim().max(500, 'Max. 500 characters').optional(),
    })
    .superRefine((v, ctx) => {
      if (v.odometerKm < intakeKm) ctx.addIssue({ code: 'custom', path: ['odometerKm'], message: `Cannot be lower than the intake reading (${fmtNumber(intakeKm)} km)` })
      if (mode === 'complete') {
        if (!v.completedAt) ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'Enter the completion time' })
        else if (new Date(v.completedAt).getTime() > Date.now() + 5 * 60000) ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'Completion time cannot be in the future' })
      }
      if (v.createFollowUp) {
        if (!v.followUpTask || v.followUpTask.length < 3) ctx.addIssue({ code: 'custom', path: ['followUpTask'], message: 'Name the follow-up task' })
        if (!v.followUpKm && !v.followUpDays) ctx.addIssue({ code: 'custom', path: ['followUpDays'], message: 'Set a km or day interval' })
      }
    })
}

function CompleteFields({ form, wo, mode }: { form: AnyForm; wo: WorkOrder; mode: 'complete' | 'progress' }) {
  const money = useMoney()
  const providers = useDb((s) => s.providers)
  const workOrders = useDb((s) => s.workOrders)
  const schedules = useDb((s) => s.schedules)
  const rate = providers.find((p) => p.id === wo.providerId)?.hourlyRateUsd ?? 0
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'parts' })
  const parts = (useWatch({ control: form.control, name: 'parts' }) ?? []) as { qty?: number; unitCostUsd?: number }[]
  const labour = (useWatch({ control: form.control, name: 'labourCostUsd' }) as number | undefined) ?? 0
  const createFollowUp = useWatch({ control: form.control, name: 'createFollowUp' }) as boolean
  const serviceIds = (useWatch({ control: form.control, name: 'serviceIds' }) ?? []) as string[]

  // labour hours × provider rate → labour cost
  useEffect(() => {
    const sub = form.watch((v: { labourHours?: number }, info: { name?: string }) => {
      if (info.name === 'labourHours' && typeof v.labourHours === 'number' && rate) form.setValue('labourCostUsd', Math.round(v.labourHours * rate), { shouldValidate: true })
    })
    return () => sub.unsubscribe()
  }, [form, rate])

  const catalogue = useMemo(() => {
    const m = new Map<string, { name: string; partNo: string; unitCostUsd: number }>()
    for (const w of workOrders) for (const p of w.parts) m.set(p.partNo || p.name, { name: p.name, partNo: p.partNo, unitCostUsd: p.unitCostUsd })
    return m
  }, [workOrders])
  const catalogueOptions = useMemo(() => [...catalogue.entries()].map(([k, p]) => ({ value: k, label: p.name, hint: p.partNo })).sort((a, b) => a.label.localeCompare(b.label)), [catalogue])
  const vehicleSchedules = useMemo(() => schedules.filter((s) => s.vehicleId === wo.vehicleId), [schedules, wo.vehicleId])

  const partsSum = parts.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.unitCostUsd) || 0), 0)
  const toggleService = (id: string, on: boolean) => form.setValue('serviceIds', on ? [...serviceIds, id] : serviceIds.filter((x) => x !== id), { shouldDirty: true })

  return (
    <>
      <FormSection title="Work performed" description={`${wo.title} · ${rate ? `${money(rate)}/h labour rate` : 'no labour rate on file'}`}>
        <FormGrid>
          {mode === 'complete' && <DateField form={form} name="completedAt" label="Completed on" withTime required />}
          <NumberField form={form} name="odometerKm" label="Odometer" required suffix="km" min={0} />
          <NumberField form={form} name="labourHours" label="Labour hours" suffix="h" min={0} step={0.5} hint="Auto-calculates labour cost from the provider rate" />
          <NumberField form={form} name="labourCostUsd" label="Labour cost" required suffix="USD" min={0} />
          <NumberField form={form} name="downtimeHours" label="Vehicle downtime" required suffix="h" min={0} hint="Time off the road for this job" />
        </FormGrid>
      </FormSection>

      <FormSection title="Parts used" description={`${fields.length} line${fields.length === 1 ? '' : 's'} · ${money(partsSum, { digits: 2 })}`}>
        {fields.length === 0 && <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">No parts recorded. Add parts from the catalogue or enter them manually.</p>}
        <div className="space-y-2.5">
          {fields.map((f, i) => {
            const line = (Number(parts[i]?.qty) || 0) * (Number(parts[i]?.unitCostUsd) || 0)
            return (
              <div key={f.id} className="space-y-2 rounded-md border border-border bg-surface-2/40 p-2.5">
                <div className="flex items-start gap-2">
                  <TextField form={form} name={`parts.${i}.name`} placeholder="Part name" className="flex-1" />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label={`Remove part ${i + 1}`} className="mt-0.5 text-muted-foreground hover:text-danger"><Trash2 /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <TextField form={form} name={`parts.${i}.partNo`} placeholder="Part no." />
                  <NumberField form={form} name={`parts.${i}.qty`} placeholder="Qty" min={1} step={1} suffix="qty" />
                  <NumberField form={form} name={`parts.${i}.unitCostUsd`} placeholder="Unit cost" min={0} suffix="USD" />
                  <div className="flex h-8 items-center justify-end rounded-md bg-surface-3/60 px-2.5 text-[13px]"><span className="num font-medium">{money(line, { digits: 2 })}</span></div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => append({ name: '', partNo: '', qty: 1, unitCostUsd: 0 })}><Plus /> Add part</Button>
          <div className="w-56">
            <Combobox
              options={catalogueOptions}
              value={null}
              placeholder="Add from catalogue…"
              searchPlaceholder="Search parts…"
              onChange={(k) => {
                const p = k ? catalogue.get(k) : undefined
                if (p) append({ name: p.name, partNo: p.partNo, qty: 1, unitCostUsd: p.unitCostUsd })
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md bg-surface-3/60 px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">Labour {money(labour, { digits: 2 })} + Parts {money(partsSum, { digits: 2 })}</span>
          <span className="font-semibold">Total <span className="num">{money(labour + partsSum, { digits: 2 })}</span></span>
        </div>
      </FormSection>

      {mode === 'complete' && (
        <FormSection title="Service schedules" description="Reset the intervals this job satisfied">
          {vehicleSchedules.length === 0 ? (
            <p className="text-xs text-muted-foreground">No service schedules exist for this vehicle yet.</p>
          ) : (
            <div className="space-y-1.5">
              {vehicleSchedules.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-[13px] hover:bg-accent/40">
                  <Checkbox checked={serviceIds.includes(s.id)} onCheckedChange={(c) => toggleService(s.id, !!c)} />
                  <span className="min-w-0 flex-1 truncate">{s.task}</span>
                  <span className="num shrink-0 text-xs text-muted-foreground">due {fmtDate(s.nextDueDate)}</span>
                </label>
              ))}
            </div>
          )}
          <SwitchField form={form} name="createFollowUp" label="Create a follow-up service schedule" hint="Track a new recurring task for this vehicle (e.g. next tyre rotation)." />
          {createFollowUp && (
            <FormGrid>
              <TextField form={form} name="followUpTask" label="Task" required placeholder="e.g. Gearbox oil change" className="sm:col-span-2" />
              <NumberField form={form} name="followUpKm" label="Every" suffix="km" min={0} />
              <NumberField form={form} name="followUpDays" label="or every" suffix="days" min={0} />
              <NumberField form={form} name="followUpCost" label="Estimated cost" suffix="USD" min={0} />
            </FormGrid>
          )}
        </FormSection>
      )}

      <TextAreaField form={form} name="notes" label={mode === 'complete' ? 'Completion notes' : 'Progress note'} rows={2} placeholder="Findings, work carried out, recommendations…" />
    </>
  )
}

export function CompleteWorkOrderDialog({ open, onOpenChange, wo, mode }: { open: boolean; onOpenChange: (o: boolean) => void; wo?: WorkOrder; mode: 'complete' | 'progress' }) {
  const odometers = useOdometers()
  const getVehicle = useById('vehicles')
  const providers = useDb((s) => s.providers)
  const schema = useMemo(() => makeCompleteSchema(mode, wo?.odometerKm ?? 0), [mode, wo?.odometerKm])

  const defaultValues = useMemo<z.input<ReturnType<typeof makeCompleteSchema>>>(() => {
    if (!wo) return { odometerKm: 0, labourCostUsd: 0, downtimeHours: 0, parts: [], serviceIds: [], createFollowUp: false }
    const rate = providers.find((p) => p.id === wo.providerId)?.hourlyRateUsd ?? 0
    const veh = getVehicle(wo.vehicleId)
    const odo = Math.round(Math.max(odometers.get(wo.vehicleId) ?? 0, veh?.odometerKm ?? 0, wo.odometerKm))
    const linked = linkedScheduleId(wo.notes)
    const siblings = useDb.getState().schedules.filter((s) => s.vehicleId === wo.vehicleId)
    const pre = new Set<string>()
    if (linked) pre.add(linked)
    else for (const s of siblings) if ((wo.type === 'preventive' && /routine|service/i.test(s.task)) || (wo.type === 'tyre' && /tyre/i.test(s.task))) pre.add(s.id)
    const elapsed = wo.startedAt ? Math.max(0, (Date.now() - new Date(wo.startedAt).getTime()) / HOUR) : 0
    return {
      completedAt: toInputDateTime(new Date().toISOString()),
      odometerKm: odo,
      labourHours: wo.labourCostUsd && rate ? Math.round((wo.labourCostUsd / rate) * 2) / 2 : undefined,
      labourCostUsd: wo.labourCostUsd,
      downtimeHours: wo.downtimeHours || Math.round(elapsed),
      parts: wo.parts.map((p) => ({ ...p })),
      serviceIds: [...pre],
      createFollowUp: false,
      followUpTask: '',
      notes: '',
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, open, mode])

  const veh = getVehicle(wo?.vehicleId)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      size="lg"
      title={mode === 'complete' ? `Complete ${wo?.woNo ?? 'work order'}` : `Parts & costs — ${wo?.woNo ?? ''}`}
      description={veh ? `${veh.reg} · ${veh.make} ${veh.model}${mode === 'complete' ? ' — completing releases the vehicle back to service.' : ''}` : undefined}
      schema={schema}
      defaultValues={defaultValues}
      submitLabel={mode === 'complete' ? 'Complete work order' : 'Save costs'}
      onSubmit={(v) => {
        if (!wo) return
        const parts = v.parts.map((p) => ({ name: p.name, partNo: p.partNo ?? '', qty: p.qty, unitCostUsd: p.unitCostUsd }))
        const base = { labourCostUsd: v.labourCostUsd, parts, downtimeHours: v.downtimeHours, odometerKm: v.odometerKm, notes: v.notes }
        if (mode === 'progress') return saveWorkOrderProgress(wo, base)
        completeWorkOrder(wo, {
          ...base,
          completedAt: new Date(v.completedAt!).toISOString(),
          serviceIds: v.serviceIds,
          followUp: v.createFollowUp ? { task: v.followUpTask!, intervalKm: v.followUpKm ?? null, intervalDays: v.followUpDays ?? null, estCostUsd: v.followUpCost ?? 0 } : null,
        })
      }}
    >
      {(form) => (wo ? <CompleteFields form={form} wo={wo} mode={mode} /> : null)}
    </FormDialog>
  )
}

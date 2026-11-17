import * as React from 'react'
import { useWatch } from 'react-hook-form'
import { format } from 'date-fns'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileUp, Info, UserMinus } from 'lucide-react'
import type { DocumentRecord, DocumentType, Vehicle, WorkOrderType } from '@/types'
import { useDb } from '@/store/db'
import { useById } from '@/hooks/useLookup'
import { useBranchOptions, useProviderOptions } from '@/hooks/useOptions'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, Field, FormGrid, SelectField, SwitchField, TextAreaField, TextField, type AnyForm } from '@/components/forms/fields'
import { Avatar, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { ExpiryBadge } from '@/components/shared/Status'
import { WORKORDER_TYPE, expiryState, statusMeta, VEHICLE_STATUS } from '@/config/status'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import { VehicleFormDialog } from './VehicleFormDialog'
import { addDocument, assignDriver, changeBranch, changeStatus, renewDocument, scheduleMaintenance } from './actions'
import { VEHICLE_DOC_OPTIONS, VEHICLE_DOC_TYPES, fmtBytesKb } from './lib'

/* ------------------------------------------------------------------ */
/* Dialog state + host                                                 */
/* ------------------------------------------------------------------ */
export type VehicleDialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; vehicle: Vehicle }
  | { kind: 'assign'; vehicle: Vehicle }
  | { kind: 'status'; vehicles: Vehicle[] }
  | { kind: 'branch'; vehicles: Vehicle[] }
  | { kind: 'maintenance'; vehicle: Vehicle; preset?: { title?: string; type?: WorkOrderType } }
  | { kind: 'document'; vehicle: Vehicle; doc?: DocumentRecord; type?: DocumentType }

export type ShowVehicleDialog = (d: Exclude<VehicleDialog, { kind: 'none' }>) => void

/**
 * One hook, every vehicle workflow: `const dlg = useVehicleDialogs(); dlg.show({ kind: 'edit', vehicle })` and render `{dlg.host}` once.
 */
export function useVehicleDialogs(opts: { onCreated?: (v: Vehicle) => void } = {}) {
  const [state, setState] = React.useState<VehicleDialog>({ kind: 'none' })
  const [open, setOpen] = React.useState(false)
  const show = React.useCallback<ShowVehicleDialog>((d) => {
    setState(d)
    setOpen(true)
  }, [])
  const { onCreated } = opts
  const host = <VehicleDialogHost state={state} open={open} onOpenChange={setOpen} onCreated={onCreated} />
  return { show, host }
}

function VehicleDialogHost({ state, open, onOpenChange, onCreated }: { state: VehicleDialog; open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (v: Vehicle) => void }) {
  const is = (k: VehicleDialog['kind']) => open && state.kind === k
  return (
    <>
      <VehicleFormDialog open={is('create') || is('edit')} onOpenChange={onOpenChange} vehicle={state.kind === 'edit' ? state.vehicle : undefined} onCreated={onCreated} />
      <AssignDriverDialog open={is('assign')} onOpenChange={onOpenChange} vehicle={state.kind === 'assign' ? state.vehicle : null} />
      <StatusDialog open={is('status')} onOpenChange={onOpenChange} vehicles={state.kind === 'status' ? state.vehicles : []} />
      <BranchDialog open={is('branch')} onOpenChange={onOpenChange} vehicles={state.kind === 'branch' ? state.vehicles : []} />
      <MaintenanceDialog open={is('maintenance')} onOpenChange={onOpenChange} vehicle={state.kind === 'maintenance' ? state.vehicle : null} preset={state.kind === 'maintenance' ? state.preset : undefined} />
      <DocumentDialog open={is('document')} onOpenChange={onOpenChange} vehicle={state.kind === 'document' ? state.vehicle : null} doc={state.kind === 'document' ? state.doc : undefined} presetType={state.kind === 'document' ? state.type : undefined} />
    </>
  )
}

const today = () => format(new Date(), 'yyyy-MM-dd')

function Note({ tone = 'info', icon, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: React.ReactNode; children: React.ReactNode }) {
  const cls = { info: 'border-info/30 bg-info/10 text-info', warning: 'border-warning/30 bg-warning/10 text-warning', danger: 'border-danger/30 bg-danger/10 text-danger', success: 'border-success/30 bg-success/10 text-success' }[tone]
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-xs', cls)}>
      <span className="mt-px shrink-0 [&>svg]:size-3.5">{icon ?? <Info />}</span>
      <div className="min-w-0 text-foreground/90">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Assign / unassign driver                                            */
/* ------------------------------------------------------------------ */
function AssignDriverDialog({ open, onOpenChange, vehicle }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle: Vehicle | null }) {
  const drivers = useDb((s) => s.drivers)
  const vehicles = useDb((s) => s.vehicles)
  const getDriver = useById('drivers')
  const currentDriver = getDriver(vehicle?.driverId)

  const options = React.useMemo(() => {
    const regOf = new Map(vehicles.map((v) => [v.id, v.reg]))
    return drivers
      .map((d) => {
        const lic = expiryState(d.licenceExpiry)
        const blocked = d.status === 'suspended' || lic.state === 'expired'
        const hint = d.status === 'suspended' ? 'Suspended' : lic.state === 'expired' ? 'Licence expired' : d.id === vehicle?.driverId ? 'Current driver' : d.vehicleId ? `Drives ${regOf.get(d.vehicleId) ?? 'a vehicle'}` : 'Unassigned'
        return { value: d.id, label: d.name, hint, disabled: blocked, free: !d.vehicleId && !blocked }
      })
      .sort((a, b) => Number(b.free) - Number(a.free) || a.label.localeCompare(b.label))
  }, [drivers, vehicles, vehicle?.driverId])

  const schema = React.useMemo(() => {
    const byId = new Map(drivers.map((d) => [d.id, d]))
    return z
      .object({ driverId: z.string() })
      .refine((v) => !!v.driverId || !!vehicle?.driverId, { message: 'Select a driver to assign', path: ['driverId'] })
      .refine((v) => !v.driverId || v.driverId !== vehicle?.driverId, { message: 'This driver is already assigned to the vehicle', path: ['driverId'] })
      .refine((v) => byId.get(v.driverId)?.status !== 'suspended', { message: 'Suspended drivers cannot be assigned', path: ['driverId'] })
      .refine((v) => !v.driverId || expiryState(byId.get(v.driverId)?.licenceExpiry).state !== 'expired', { message: "This driver's licence has expired", path: ['driverId'] })
  }, [drivers, vehicle?.driverId])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={currentDriver ? `Change driver — ${vehicle?.reg}` : `Assign driver — ${vehicle?.reg ?? ''}`}
      description={currentDriver ? `Currently driven by ${currentDriver.name}. Choose a replacement, or clear the selection to unassign.` : 'Pick a driver for this vehicle. Both records are updated together.'}
      schema={schema}
      defaultValues={{ driverId: vehicle?.driverId ?? '' }}
      submitLabel="Save assignment"
      onSubmit={(v) => {
        if (!vehicle) return
        assignDriver(vehicle.id, v.driverId || null)
        toast.success(v.driverId ? `${getDriver(v.driverId)?.name ?? 'Driver'} assigned to ${vehicle.reg}` : `Driver unassigned from ${vehicle.reg}`)
      }}
    >
      {(form) => (
        <>
          <ComboField form={form} name="driverId" label="Driver" options={options} placeholder="Select a driver" searchPlaceholder="Search by name or employee no…" clearable required={!currentDriver} />
          <DriverPreview form={form} vehicle={vehicle} />
        </>
      )}
    </FormDialog>
  )
}

function DriverPreview({ form, vehicle }: { form: AnyForm; vehicle: Vehicle | null }) {
  const driverId = useWatch({ control: form.control, name: 'driverId' }) as string | undefined
  const getDriver = useById('drivers')
  const getVehicle = useById('vehicles')
  const current = getDriver(vehicle?.driverId)
  const next = getDriver(driverId)

  if (!next) {
    return current ? (
      <Note tone="warning" icon={<UserMinus />}>
        Saving with no driver selected will <b>unassign {current.name}</b> from {vehicle?.reg}. {current.name} will become available for other vehicles.
      </Note>
    ) : null
  }
  const movedFrom = next.vehicleId && next.vehicleId !== vehicle?.id ? getVehicle(next.vehicleId) : undefined
  const lic = expiryState(next.licenceExpiry)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2/50 p-3">
        <Avatar name={next.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{next.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {next.empNo} · {next.licenceClass} · Safety score {next.safetyScore}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={statusMeta('driver', next.status).tone}>{statusMeta('driver', next.status).label}</Badge>
          <span className="text-[11px] text-subtle-foreground">
            Licence <ExpiryBadge iso={next.licenceExpiry} />
          </span>
        </div>
      </div>
      {movedFrom && (
        <Note tone="warning">
          {next.name} currently drives <b>{movedFrom.reg}</b>; that vehicle will be left without a driver.
        </Note>
      )}
      {current && next.id !== current.id && (
        <Note>
          {current.name} will be released from {vehicle?.reg}.
        </Note>
      )}
      {next.status !== 'active' && next.status !== 'suspended' && (
        <Note tone="warning" icon={<AlertTriangle />}>
          Driver is currently marked <b>{statusMeta('driver', next.status).label.toLowerCase()}</b>.
        </Note>
      )}
      {lic.state === 'expiring' && (
        <Note tone="warning" icon={<AlertTriangle />}>
          Licence expires in {lic.days} days — arrange a renewal.
        </Note>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Update status (single or bulk)                                      */
/* ------------------------------------------------------------------ */
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active — available for dispatch' },
  { value: 'maintenance', label: 'In maintenance — in the workshop' },
  { value: 'out_of_service', label: 'Out of service — withdrawn from the fleet' },
]
const WO_TYPES = (Object.keys(WORKORDER_TYPE) as WorkOrderType[]).map((value) => ({ value, label: WORKORDER_TYPE[value] }))
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const statusSchema = z
  .object({
    status: z.enum(['active', 'maintenance', 'out_of_service'], { error: 'Select a status' }),
    reason: z.string().max(300, 'Max 300 characters').optional(),
    createWo: z.boolean(),
    woType: z.enum(['preventive', 'corrective', 'breakdown', 'inspection', 'tyre', 'accident_repair']),
    woTitle: z.string().optional(),
    woPriority: z.enum(['low', 'medium', 'high', 'critical']),
    woProviderId: z.string().optional(),
    closeWos: z.boolean(),
  })
  .refine((v) => v.status === 'active' || (v.reason?.trim().length ?? 0) >= 5, { message: 'Give a reason (at least 5 characters)', path: ['reason'] })
  .refine((v) => !(v.status === 'maintenance' && v.createWo) || (v.woTitle?.trim().length ?? 0) >= 3, { message: 'Work order title is required', path: ['woTitle'] })
  .refine((v) => !(v.status === 'maintenance' && v.createWo) || !!v.woProviderId, { message: 'Select a service provider', path: ['woProviderId'] })

function StatusDialog({ open, onOpenChange, vehicles }: { open: boolean; onOpenChange: (o: boolean) => void; vehicles: Vehicle[] }) {
  const providerOptions = useProviderOptions()
  const single = vehicles.length === 1 ? vehicles[0]! : null
  const title = single ? `Update status — ${single.reg}` : `Update status — ${vehicles.length} vehicles`
  const defaultStatus = single ? (single.status === 'active' ? 'maintenance' : 'active') : 'maintenance'

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={single ? `Currently ${VEHICLE_STATUS[single.status].label.toLowerCase()}. The change is recorded in the audit log.` : 'The same status is applied to every selected vehicle.'}
      schema={statusSchema}
      defaultValues={{ status: defaultStatus, reason: '', createWo: true, woType: 'corrective', woTitle: '', woPriority: 'medium', woProviderId: '', closeWos: true }}
      submitLabel="Update status"
      onSubmit={(v) => {
        const res = changeStatus(
          vehicles.map((x) => x.id),
          {
            status: v.status,
            reason: v.reason,
            closeWorkOrders: v.closeWos,
            workOrder: v.status === 'maintenance' && v.createWo && single ? { type: v.woType, title: v.woTitle ?? '', priority: v.woPriority, providerId: v.woProviderId ?? '', description: v.reason } : undefined,
          },
        )
        if (!res.changed.length) {
          if (res.blocked.length) throw new Error(`${res.blocked.map((b) => `${b.reg} is ${b.reason}`).join('; ')}. Complete or cancel the trip first.`)
          throw new Error('The selected vehicle(s) already have this status.')
        }
        const label = VEHICLE_STATUS[v.status].label
        toast.success(res.changed.length === 1 ? `${single?.reg ?? 'Vehicle'} is now ${label.toLowerCase()}` : `${res.changed.length} vehicles set to ${label.toLowerCase()}`, {
          description: res.blocked.length ? `${res.blocked.length} skipped (${res.blocked.map((b) => b.reg).join(', ')}) — on an active trip.` : undefined,
        })
      }}
    >
      {(form) => (
        <>
          <SelectField form={form} name="status" label="New status" required options={STATUS_OPTIONS} />
          <StatusExtras form={form} single={single} providerOptions={providerOptions} />
        </>
      )}
    </FormDialog>
  )
}

function StatusExtras({ form, single, providerOptions }: { form: AnyForm; single: Vehicle | null; providerOptions: { value: string; label: string }[] }) {
  const status = useWatch({ control: form.control, name: 'status' }) as string
  const createWo = useWatch({ control: form.control, name: 'createWo' }) as boolean
  const workOrders = useDb((s) => s.workOrders)
  const trips = useDb((s) => s.trips)
  const open = single ? workOrders.filter((w) => w.vehicleId === single.id && w.status === 'in_progress') : []
  const onTrip = single ? trips.find((t) => t.vehicleId === single.id && (t.status === 'in_transit' || t.status === 'delayed')) : undefined

  return (
    <>
      {status !== 'active' && onTrip && (
        <Note tone="danger" icon={<AlertTriangle />}>
          {single?.reg} is on active trip <b>{onTrip.ref}</b>. Complete or cancel the trip before taking it out of service.
        </Note>
      )}
      <TextAreaField form={form} name="reason" label={status === 'active' ? 'Note (optional)' : 'Reason'} required={status !== 'active'} placeholder={status === 'maintenance' ? 'e.g. Gearbox noise reported by driver; booked into workshop' : 'Why is the status changing?'} rows={3} />
      {status === 'maintenance' && single && (
        <div className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
          <SwitchField form={form} name="createWo" label="Create a maintenance work order" hint="Opens an in-progress work order so the downtime is tracked and costed." />
          {createWo && (
            <FormGrid>
              <SelectField form={form} name="woType" label="Type" options={WO_TYPES} />
              <SelectField form={form} name="woPriority" label="Priority" options={PRIORITIES} />
              <TextField form={form} name="woTitle" label="Work order title" required className="sm:col-span-2" placeholder="e.g. Gearbox diagnosis & repair" />
              <SelectField form={form} name="woProviderId" label="Service provider" required options={providerOptions} placeholder="Select provider" className="sm:col-span-2" />
            </FormGrid>
          )}
        </div>
      )}
      {status === 'active' && single && open.length > 0 && (
        <SwitchField form={form} name="closeWos" label={`Complete ${open.length} in-progress work order${open.length > 1 ? 's' : ''}`} hint={`${open.map((w) => w.woNo).join(', ')} — marks them completed and records the downtime.`} />
      )}
      {status === 'out_of_service' && (
        <Note tone="warning" icon={<AlertTriangle />}>
          Out-of-service vehicles are excluded from dispatch and show as offline on the map. Assigned drivers stay linked until reassigned.
        </Note>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Bulk: assign branch                                                 */
/* ------------------------------------------------------------------ */
function BranchDialog({ open, onOpenChange, vehicles }: { open: boolean; onOpenChange: (o: boolean) => void; vehicles: Vehicle[] }) {
  const branchOptions = useBranchOptions()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Move ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} to a branch`}
      description="Updates the home branch (depot) of every selected vehicle."
      schema={z.object({ branchId: z.string().min(1, 'Select a branch') })}
      defaultValues={{ branchId: '' }}
      submitLabel="Move vehicles"
      onSubmit={(v) => {
        const n = changeBranch(vehicles.map((x) => x.id), v.branchId)
        const name = branchOptions.find((b) => b.value === v.branchId)?.label ?? 'branch'
        if (!n) throw new Error('All selected vehicles already belong to this branch.')
        toast.success(`${n} vehicle${n === 1 ? '' : 's'} moved to ${name}`)
      }}
    >
      {(form) => <SelectField form={form} name="branchId" label="Branch / depot" required options={branchOptions} placeholder="Select branch" />}
    </FormDialog>
  )
}

/* ------------------------------------------------------------------ */
/* Schedule maintenance                                                */
/* ------------------------------------------------------------------ */
const maintenanceSchema = z.object({
  type: z.enum(['preventive', 'corrective', 'breakdown', 'inspection', 'tyre', 'accident_repair'], { error: 'Select a type' }),
  title: z.string().trim().min(3, 'Give the work order a title'),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  providerId: z.string().min(1, 'Select a service provider'),
  scheduledDate: z.string().min(1, 'Select a date').refine((d) => d >= today(), 'Date cannot be in the past'),
  technician: z.string().max(80).optional(),
  description: z.string().max(500, 'Max 500 characters').optional(),
})

function MaintenanceDialog({ open, onOpenChange, vehicle, preset }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle: Vehicle | null; preset?: { title?: string; type?: WorkOrderType } }) {
  const providerOptions = useProviderOptions()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Schedule maintenance — ${vehicle?.reg ?? ''}`}
      description="Creates a scheduled work order that appears in Maintenance → Work orders and the maintenance calendar."
      schema={maintenanceSchema}
      defaultValues={{ type: preset?.type ?? 'preventive', title: preset?.title ?? '', priority: 'medium', providerId: '', scheduledDate: format(new Date(Date.now() + 3 * 864e5), 'yyyy-MM-dd'), technician: '', description: '' }}
      submitLabel="Schedule work order"
      onSubmit={(v) => {
        if (!vehicle) return
        const wo = scheduleMaintenance(vehicle.id, v)
        toast.success(`${wo.woNo} scheduled for ${fmtDate(wo.scheduledDate)}`, { description: `${wo.title} — ${vehicle.reg}` })
      }}
    >
      {(form) => (
        <>
          <FormGrid>
            <SelectField form={form} name="type" label="Type" required options={WO_TYPES} />
            <SelectField form={form} name="priority" label="Priority" required options={PRIORITIES} />
          </FormGrid>
          <TextField form={form} name="title" label="Title" required placeholder="e.g. Routine service (B)" />
          <FormGrid>
            <DateField form={form} name="scheduledDate" label="Scheduled date" required min={today()} />
            <SelectField form={form} name="providerId" label="Service provider" required options={providerOptions} placeholder="Select provider" />
          </FormGrid>
          <TextField form={form} name="technician" label="Technician" placeholder="Optional" />
          <TextAreaField form={form} name="description" label="Description" placeholder="Scope of work, parts to order, driver-reported faults…" rows={3} />
        </>
      )}
    </FormDialog>
  )
}

/* ------------------------------------------------------------------ */
/* Upload / renew document                                             */
/* ------------------------------------------------------------------ */
const documentSchema = z
  .object({
    type: z.enum(VEHICLE_DOC_TYPES, { error: 'Select a document type' }),
    number: z.string().trim().min(3, 'Document / policy number is required'),
    issuer: z.string().trim().min(2, 'Issuing authority is required'),
    issueDate: z.string().min(1, 'Issue date is required'),
    expiryDate: z.string().min(1, 'Expiry date is required'),
    fileName: z.string().min(1, 'Choose a file to attach'),
    fileSizeKb: z.number().optional(),
  })
  .refine((v) => !v.issueDate || !v.expiryDate || v.expiryDate > v.issueDate, { message: 'Expiry must be after the issue date', path: ['expiryDate'] })

function DocumentDialog({ open, onOpenChange, vehicle, doc, presetType }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle: Vehicle | null; doc?: DocumentRecord; presetType?: DocumentType }) {
  const renewing = !!doc
  const defaults = React.useMemo(() => {
    const base = doc && new Date(doc.expiryDate) > new Date() ? new Date(doc.expiryDate) : new Date()
    const plusYear = new Date(base.getTime() + 365 * 864e5)
    return {
      type: doc?.type ?? presetType ?? 'insurance',
      number: doc?.number ?? '',
      issuer: doc?.issuer ?? '',
      issueDate: today(),
      expiryDate: format(plusYear, 'yyyy-MM-dd'),
      fileName: '',
      fileSizeKb: undefined,
    }
  }, [doc, presetType, open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={renewing ? `Renew document — ${vehicle?.reg ?? ''}` : `Upload document — ${vehicle?.reg ?? ''}`}
      description={renewing ? 'Replaces the current certificate with the renewed one (new number, dates and file).' : 'Attach a compliance document. Expiry dates feed the compliance reminders.'}
      schema={documentSchema}
      defaultValues={defaults as never}
      submitLabel={renewing ? 'Renew document' : 'Upload document'}
      onSubmit={(v) => {
        if (!vehicle) return
        const input = { ...v, fileSizeKb: v.fileSizeKb ?? 240 }
        if (doc) renewDocument(doc.id, input)
        else addDocument(vehicle.id, input)
        toast.success(renewing ? 'Document renewed' : 'Document uploaded', { description: `${v.number} · valid until ${fmtDate(v.expiryDate)}` })
      }}
    >
      {(form) => (
        <>
          <FormGrid>
            <SelectField form={form} name="type" label="Document type" required options={VEHICLE_DOC_OPTIONS} disabled={renewing} />
            <TextField form={form} name="number" label="Document / policy no." required />
            <TextField form={form} name="issuer" label="Issuing authority" required placeholder="e.g. ZINARA, VID Zimbabwe" />
            <span className="hidden sm:block" />
            <DateField form={form} name="issueDate" label="Issue date" required />
            <DateField form={form} name="expiryDate" label="Expiry date" required />
          </FormGrid>
          <FilePickerField form={form} />
        </>
      )}
    </FormDialog>
  )
}

/** File chooser that records name + size only (no upload — this is a front-end demo). */
function FilePickerField({ form }: { form: AnyForm }) {
  const ref = React.useRef<HTMLInputElement>(null)
  const name = useWatch({ control: form.control, name: 'fileName' }) as string
  const size = useWatch({ control: form.control, name: 'fileSizeKb' }) as number | undefined
  const error = form.getFieldState('fileName', form.formState).error?.message as string | undefined
  return (
    <Field label="Document file" required error={error} hint="PDF or image. Only the file name and size are stored in this demo.">
      <input
        ref={ref}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          form.setValue('fileName', f.name, { shouldValidate: true, shouldDirty: true })
          form.setValue('fileSizeKb', Math.max(1, Math.round(f.size / 1024)), { shouldDirty: true })
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn('flex w-full items-center gap-3 rounded-md border border-dashed bg-surface-2/40 px-3 py-3 text-left transition-colors hover:bg-accent/40', error ? 'border-danger' : 'border-border-strong')}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted-foreground">{name ? <CheckCircle2 className="size-4 text-success" /> : <FileUp className="size-4" />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{name || 'Choose a file…'}</span>
          <span className="block text-xs text-muted-foreground">{name ? `${fmtBytesKb(size ?? 0)} · click to replace` : 'Click to browse'}</span>
        </span>
        {name && <Button type="button" size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); form.setValue('fileName', '', { shouldValidate: true }); form.setValue('fileSizeKb', undefined) }}>Remove</Button>}
      </button>
    </Field>
  )
}

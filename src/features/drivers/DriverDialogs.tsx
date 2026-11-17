import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, ShieldAlert, Upload } from 'lucide-react'
import { useDb } from '@/store/db'
import { useBranchScope } from '@/hooks/useFilters'
import { useBranchOptions } from '@/hooks/useOptions'
import { Button } from '@/components/ui/button'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, Field, FormGrid, FormSection, NumberField, SelectField, SwitchField, TextAreaField, TextField, toInputDate, type AnyForm } from '@/components/forms/fields'
import { DRIVER_STATUS, VEHICLE_CATEGORY } from '@/config/status'
import { fmtNumber } from '@/lib/format'
import { ExpiryNote } from './DriverParts'
import { EMPLOYMENT_TYPES, GENDER_OPTIONS, LICENCE_CLASSES, STATUS_OPTIONS, ageOf } from './driverData'
import {
  DRIVER_DOC_TYPES, addDriverDocument, assignVehicle, assignmentIssues, createDriver, driverConflict, nextEmpNo, setDriverStatus, updateDriver, upcomingTripsFor,
  type BulkResult, type DriverFormValues,
} from './driverActions'

const DAY = 864e5
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^\+?[0-9][0-9\s-]{7,16}$/
const NID_RE = /^\d{2}-\d{6,7}\s?[A-Za-z]\s?\d{2}$/
const dateOf = (v: string) => new Date(`${v}T00:00:00`).getTime()
const todayInput = () => new Date().toISOString().slice(0, 10)

/* ================================================================================================
 * Add / edit driver
 * ============================================================================================== */

function buildDriverSchema(editing: boolean, exceptId?: string) {
  return z
    .object({
      name: z.string().trim().min(3, 'Enter the driver’s full name').refine((v) => v.split(/\s+/).length >= 2, 'Enter first name and surname'),
      empNo: z.string().trim().min(3, 'Employee number is required'),
      nationalId: z.string().trim().regex(NID_RE, 'Use the format 63-123456 A 42'),
      dob: z.string().min(1, 'Date of birth is required'),
      gender: z.string().min(1, 'Select a gender'),
      phone: z.string().trim().regex(PHONE_RE, 'Enter a valid phone number, e.g. +263 77 123 4567'),
      email: z.string().trim().regex(EMAIL_RE, 'Enter a valid email address'),
      address: z.string().trim().min(5, 'Enter the residential address'),
      licenceNo: z.string().trim().min(5, 'Licence number is required').max(14, 'Licence number looks too long'),
      licenceClass: z.string().min(1, 'Select a licence class'),
      licenceExpiry: z.string().min(1, 'Licence expiry is required'),
      defensiveDrivingExpiry: z.string().min(1, 'Defensive-driving expiry is required'),
      medicalExpiry: z.string().min(1, 'Medical expiry is required'),
      hireDate: z.string().min(1, 'Hire date is required'),
      employmentType: z.string().min(1, 'Select an employment type'),
      branchId: z.string().min(1, 'Select a branch'),
      salaryUsd: z.number({ error: 'Enter the monthly salary' }).min(100, 'Salary looks too low').max(20000, 'Salary looks too high'),
      emergencyContact: z.string().trim().min(3, 'Emergency contact name is required'),
      emergencyPhone: z.string().trim().regex(PHONE_RE, 'Enter a valid phone number'),
      vehicleId: z.string().optional(),
      notes: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
      const now = Date.now()
      if (v.dob) {
        const age = ageOf(`${v.dob}T00:00:00`, now)
        if (age < 18) issue('dob', 'Driver must be at least 18 years old')
        else if (age > 75) issue('dob', 'Please check the date of birth')
      }
      if (v.hireDate) {
        if (dateOf(v.hireDate) > now + DAY) issue('hireDate', 'Hire date cannot be in the future')
        else if (v.dob && dateOf(v.hireDate) < dateOf(v.dob) + 17 * 365 * DAY) issue('hireDate', 'Hire date is before the driver turned 18')
      }
      if (v.licenceExpiry) {
        if (!editing && dateOf(v.licenceExpiry) < now - DAY) issue('licenceExpiry', 'Licence has expired — a driver cannot be onboarded on an expired licence')
        else if (dateOf(v.licenceExpiry) > now + 12 * 365 * DAY) issue('licenceExpiry', 'Licence expiry is more than 12 years away — check the date')
      }
      if (v.medicalExpiry && dateOf(v.medicalExpiry) > now + 10 * 365 * DAY) issue('medicalExpiry', 'Medical expiry is too far in the future')
      if (v.defensiveDrivingExpiry && dateOf(v.defensiveDrivingExpiry) > now + 10 * 365 * DAY) issue('defensiveDrivingExpiry', 'Training expiry is too far in the future')
      const licDup = v.licenceNo && driverConflict('licenceNo', v.licenceNo, exceptId)
      if (licDup) issue('licenceNo', `Licence number already belongs to ${licDup.name}`)
      const nidDup = v.nationalId && NID_RE.test(v.nationalId.trim()) && driverConflict('nationalId', v.nationalId, exceptId)
      if (nidDup) issue('nationalId', `National ID already belongs to ${nidDup.name}`)
      const empDup = v.empNo && driverConflict('empNo', v.empNo, exceptId)
      if (empDup) issue('empNo', `Employee number already used by ${empDup.name}`)
    })
}

export function DriverFormDialog({ open, onOpenChange, driverId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; driverId?: string | null; onSaved?: (id: string) => void }) {
  const navigate = useNavigate()
  const driver = useDb((s) => (driverId ? s.drivers.find((d) => d.id === driverId) : undefined))
  const vehicles = useDb((s) => s.vehicles)
  const branchOptions = useBranchOptions()
  const { branchId: scopeBranch } = useBranchScope()
  const editing = !!driver
  const schema = useMemo(() => buildDriverSchema(editing, driver?.id), [editing, driver?.id])
  const vehicleOptions = useMemo(
    () => vehicles.filter((v) => !v.driverId && v.status !== 'out_of_service').map((v) => ({ value: v.id, label: v.reg, hint: `${v.make} ${v.model}` })).sort((a, b) => a.label.localeCompare(b.label)),
    [vehicles],
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaults = useMemo<z.input<typeof schema>>(() => {
    if (driver) {
      return {
        name: driver.name, empNo: driver.empNo, nationalId: driver.nationalId, dob: toInputDate(driver.dob), gender: driver.gender, phone: driver.phone, email: driver.email, address: driver.address,
        licenceNo: driver.licenceNo, licenceClass: driver.licenceClass, licenceExpiry: toInputDate(driver.licenceExpiry), defensiveDrivingExpiry: toInputDate(driver.defensiveDrivingExpiry), medicalExpiry: toInputDate(driver.medicalExpiry),
        hireDate: toInputDate(driver.hireDate), employmentType: driver.employmentType, branchId: driver.branchId, salaryUsd: driver.salaryUsd, emergencyContact: driver.emergencyContact, emergencyPhone: driver.emergencyPhone,
        vehicleId: '', notes: driver.notes ?? '',
      }
    }
    return {
      name: '', empNo: nextEmpNo(), nationalId: '', dob: '', gender: '', phone: '+263 ', email: '', address: '',
      licenceNo: '', licenceClass: 'Class 4', licenceExpiry: '', defensiveDrivingExpiry: '', medicalExpiry: '',
      hireDate: todayInput(), employmentType: 'permanent', branchId: scopeBranch !== 'all' ? scopeBranch : '', salaryUsd: undefined as unknown as number, emergencyContact: '', emergencyPhone: '+263 ',
      vehicleId: '', notes: '',
    }
  }, [open, driver, scopeBranch])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      size="lg"
      title={editing ? `Edit driver — ${driver!.name}` : 'Add driver'}
      description={editing ? 'Update personal, licence and employment details.' : 'Onboard a driver. They start with a safety score of 85 and an active status.'}
      schema={schema}
      defaultValues={defaults}
      submitLabel={editing ? 'Save changes' : 'Add driver'}
      onSubmit={(v) => {
        if (editing) {
          updateDriver(driver!.id, v as DriverFormValues)
          toast.success(`${v.name} updated`)
          onSaved?.(driver!.id)
        } else {
          const created = createDriver(v as DriverFormValues)
          toast.success(`${created.name} added to the roster`, { action: { label: 'View profile', onClick: () => navigate(`/drivers/${created.id}`) } })
          onSaved?.(created.id)
        }
      }}
    >
      {(form) => (
        <>
          <FormSection title="Personal details">
            <FormGrid>
              <TextField form={form} name="name" label="Full name" required placeholder="e.g. Tendai Moyo" autoComplete="off" className="sm:col-span-2" />
              <TextField form={form} name="nationalId" label="National ID" required placeholder="63-123456 A 42" hint="Zimbabwe format: 63-123456 A 42" />
              <DateField form={form} name="dob" label="Date of birth" required max={todayInput()} />
              <SelectField form={form} name="gender" label="Gender" required options={GENDER_OPTIONS} placeholder="Select gender" />
              <TextField form={form} name="phone" label="Mobile phone" required inputMode="tel" placeholder="+263 77 123 4567" />
              <TextField form={form} name="email" label="Email" required type="email" placeholder="name@company.co.zw" className="sm:col-span-2" />
              <TextField form={form} name="address" label="Residential address" required placeholder="12 Josiah Tongogara Ave, Bulawayo" className="sm:col-span-2" />
            </FormGrid>
          </FormSection>

          <FormSection title="Licence & compliance" description="Expiry dates drive dispatch eligibility and alerts">
            <FormGrid>
              <TextField form={form} name="licenceNo" label="Licence number" required placeholder="123456AB" />
              <SelectField form={form} name="licenceClass" label="Licence class" required options={LICENCE_CLASSES} />
              <DateField form={form} name="licenceExpiry" label="Licence expiry" required hint={<ExpiryNote form={form} name="licenceExpiry" />} />
              <DateField form={form} name="medicalExpiry" label="Medical certificate expiry" required hint={<ExpiryNote form={form} name="medicalExpiry" />} />
              <DateField form={form} name="defensiveDrivingExpiry" label="Defensive-driving expiry" required hint={<ExpiryNote form={form} name="defensiveDrivingExpiry" />} />
            </FormGrid>
          </FormSection>

          <FormSection title="Employment">
            <FormGrid>
              <TextField form={form} name="empNo" label="Employee number" required />
              <DateField form={form} name="hireDate" label="Hire date" required max={todayInput()} />
              <SelectField form={form} name="employmentType" label="Employment type" required options={EMPLOYMENT_TYPES} />
              <SelectField form={form} name="branchId" label="Branch" required options={branchOptions} placeholder="Select branch" />
              <NumberField form={form} name="salaryUsd" label="Monthly salary (USD)" required prefix="$" min={0} step={10} />
              {!editing && <ComboField form={form} name="vehicleId" label="Assign vehicle (optional)" options={vehicleOptions} placeholder="No vehicle" searchPlaceholder="Search unassigned vehicles…" clearable hint="Only unassigned, in-service vehicles are listed." />}
            </FormGrid>
          </FormSection>

          <FormSection title="Emergency contact">
            <FormGrid>
              <TextField form={form} name="emergencyContact" label="Contact name" required />
              <TextField form={form} name="emergencyPhone" label="Contact phone" required inputMode="tel" />
            </FormGrid>
            <TextAreaField form={form} name="notes" label="Notes" placeholder="Restrictions, endorsements, onboarding remarks…" rows={2} />
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

/* ================================================================================================
 * Assign / unassign vehicle
 * ============================================================================================== */

const assignSchema = z.object({ vehicleId: z.string().min(1, 'Select a vehicle'), reassignTrips: z.boolean().optional() })

function AssignBody({ form, driverId }: { form: AnyForm; driverId: string }) {
  const vehicleId = useWatch({ control: form.control, name: 'vehicleId' }) as string
  const driver = useDb((s) => s.drivers.find((d) => d.id === driverId))
  const vehicles = useDb((s) => s.vehicles)
  const trips = useDb((s) => s.trips)
  const vehicle = vehicles.find((v) => v.id === vehicleId)
  const issues = useMemo(() => (driver && vehicle ? assignmentIssues(driver, vehicle) : null), [driver, vehicle, vehicles, trips]) // eslint-disable-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => (driver && vehicle ? upcomingTripsFor(vehicle.id, driver.id) : []), [driver, vehicle, trips]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!vehicle || !issues) return null
  return (
    <div className="space-y-2.5">
      <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{vehicle.reg}</span> · {vehicle.make} {vehicle.model} {vehicle.year} · {VEHICLE_CATEGORY[vehicle.category]} · {fmtNumber(vehicle.odometerKm)} km
      </div>
      {issues.blockers.map((b) => (
        <p key={b} className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" />{b}</p>
      ))}
      {issues.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</p>
      ))}
      {upcoming.length > 0 && !issues.blockers.length && (
        <SwitchField form={form} name="reassignTrips" label={`Move ${upcoming.length} upcoming trip${upcoming.length === 1 ? '' : 's'} to this driver`} hint={`Scheduled / ready trips on ${vehicle.reg} will list ${driver?.name ?? 'the driver'} instead of the previous holder.`} />
      )}
    </div>
  )
}

export function AssignVehicleDialog({ open, onOpenChange, driverId }: { open: boolean; onOpenChange: (o: boolean) => void; driverId: string | null }) {
  const driver = useDb((s) => (driverId ? s.drivers.find((d) => d.id === driverId) : undefined))
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const options = useMemo(() => {
    const holder = new Map(drivers.map((d) => [d.id, d.name]))
    return vehicles
      .filter((v) => v.id !== driver?.vehicleId)
      .map((v) => ({ value: v.id, label: v.reg, hint: `${v.make} ${v.model} · ${v.status === 'out_of_service' ? 'Out of service' : v.driverId ? (holder.get(v.driverId) ?? 'Assigned') : 'Unassigned'}`, disabled: v.status === 'out_of_service' }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [vehicles, drivers, driver?.vehicleId])
  const current = driver?.vehicleId ? vehicles.find((v) => v.id === driver.vehicleId) : undefined
  const defaults = useMemo(() => ({ vehicleId: '', reassignTrips: true }), [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FormDialog
      open={open && !!driver}
      onOpenChange={onOpenChange}
      title={current ? `Change vehicle — ${driver?.name ?? ''}` : `Assign vehicle — ${driver?.name ?? ''}`}
      description={current ? `Currently driving ${current.reg}. The previous vehicle is released.` : 'Pick a vehicle. If it already has a driver they are unassigned.'}
      schema={assignSchema}
      defaultValues={defaults}
      submitLabel="Assign vehicle"
      onSubmit={(v) => {
        const d = useDb.getState().drivers.find((x) => x.id === driverId)
        const veh = useDb.getState().vehicles.find((x) => x.id === v.vehicleId)
        if (!d || !veh) throw new Error('Driver or vehicle no longer exists')
        const { blockers } = assignmentIssues(d, veh)
        if (blockers.length) throw new Error(blockers[0])
        assignVehicle(d.id, veh.id, { reassignTrips: !!v.reassignTrips })
        toast.success(`${veh.reg} assigned to ${d.name}`)
      }}
    >
      {(form) => (
        <>
          <ComboField form={form} name="vehicleId" label="Vehicle" required options={options} placeholder="Select a vehicle" searchPlaceholder="Search registration or model…" />
          <AssignBody form={form} driverId={driverId ?? ''} />
        </>
      )}
    </FormDialog>
  )
}

/* ================================================================================================
 * Change status (single or bulk)
 * ============================================================================================== */

const statusSchema = z
  .object({ status: z.string().min(1, 'Select a status'), reason: z.string().optional(), unassign: z.boolean().optional() })
  .superRefine((v, ctx) => {
    if (v.status && v.status !== 'active' && (v.reason ?? '').trim().length < 4) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason (at least 4 characters) — it is recorded in the audit log' })
  })

function StatusBody({ form, ids }: { form: AnyForm; ids: string[] }) {
  const status = useWatch({ control: form.control, name: 'status' }) as string
  const drivers = useDb((s) => s.drivers)
  const withVehicle = drivers.filter((d) => ids.includes(d.id) && d.vehicleId).length
  return (
    <>
      <TextAreaField form={form} name="reason" label={status === 'active' ? 'Note (optional)' : 'Reason'} required={!!status && status !== 'active'} placeholder={status === 'suspended' ? 'e.g. Pending outcome of incident investigation INC-2026-014' : status === 'on_leave' ? 'e.g. Annual leave 4–18 Nov' : 'Reason for the change'} rows={3} />
      {status && status !== 'active' && withVehicle > 0 && (
        <SwitchField form={form} name="unassign" label={`Release assigned vehicle${withVehicle > 1 ? 's' : ''}`} hint={`${withVehicle} driver${withVehicle > 1 ? 's hold' : ' holds'} a vehicle. Releasing makes it available for another driver.`} />
      )}
    </>
  )
}

export function DriverStatusDialog({ open, onOpenChange, driverIds, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; driverIds: string[]; onDone?: (r: BulkResult) => void }) {
  const drivers = useDb((s) => s.drivers)
  const first = drivers.find((d) => d.id === driverIds[0])
  const single = driverIds.length === 1 ? first : undefined
  const defaults = useMemo(() => ({ status: '', reason: '', unassign: true }), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FormDialog
      open={open && driverIds.length > 0}
      onOpenChange={onOpenChange}
      title={single ? `Change status — ${single.name}` : `Change status for ${driverIds.length} drivers`}
      description={single ? `Currently ${DRIVER_STATUS[single.status].label.toLowerCase()}.` : 'Applied to every selected driver. Drivers on an active trip are skipped.'}
      schema={statusSchema}
      defaultValues={defaults}
      submitLabel="Update status"
      onSubmit={(v) => {
        const res = setDriverStatus(driverIds, v.status as keyof typeof DRIVER_STATUS, (v.reason ?? '').trim(), !!v.unassign)
        if (!res.done.length) throw new Error(res.skipped[0] ? `${res.skipped[0].name}: ${res.skipped[0].reason}` : 'Nothing to update')
        toast.success(res.done.length === 1 ? `${res.done[0]} is now ${DRIVER_STATUS[v.status as keyof typeof DRIVER_STATUS].label.toLowerCase()}` : `${res.done.length} drivers set to ${DRIVER_STATUS[v.status as keyof typeof DRIVER_STATUS].label.toLowerCase()}`)
        if (res.skipped.length) toast.warning(`Skipped ${res.skipped.length}: ${res.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`)
        onDone?.(res)
      }}
    >
      {(form) => (
        <>
          <SelectField form={form} name="status" label="New status" required options={STATUS_OPTIONS.filter((o) => !single || o.value !== single.status)} placeholder="Select status" />
          <StatusBody form={form} ids={driverIds} />
        </>
      )}
    </FormDialog>
  )
}

/* ================================================================================================
 * Upload document (placeholder upload — records name/size/expiry, no file is transmitted)
 * ============================================================================================== */

const docSchema = z
  .object({
    type: z.string().min(1, 'Select a document type'),
    number: z.string().trim().min(3, 'Document number is required'),
    issuer: z.string().trim().min(2, 'Issuing authority is required'),
    issueDate: z.string().min(1, 'Issue date is required'),
    expiryDate: z.string().min(1, 'Expiry date is required'),
    fileName: z.string().trim().min(1, 'Choose a file to attach'),
    fileSizeKb: z.number({ error: 'Choose a file to attach' }).min(1),
  })
  .superRefine((v, ctx) => {
    if (v.issueDate && dateOf(v.issueDate) > Date.now() + DAY) ctx.addIssue({ code: 'custom', path: ['issueDate'], message: 'Issue date cannot be in the future' })
    if (v.issueDate && v.expiryDate && dateOf(v.expiryDate) <= dateOf(v.issueDate)) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry must be after the issue date' })
  })

function FilePickerField({ form }: { form: AnyForm }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const name = useWatch({ control: form.control, name: 'fileName' }) as string
  const size = useWatch({ control: form.control, name: 'fileSizeKb' }) as number | undefined
  const error = form.getFieldState('fileName', form.formState).error?.message as string | undefined
  return (
    <Field label="Document file" required error={error} hint="PDF, JPG or PNG. In this demo only the file name and size are stored.">
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border-strong bg-surface-2/40 px-3 py-2.5">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          aria-label="Choose document file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            form.setValue('fileName', f.name, { shouldValidate: true, shouldDirty: true })
            form.setValue('fileSizeKb', Math.max(1, Math.round(f.size / 1024)), { shouldValidate: true, shouldDirty: true })
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload /> Choose file</Button>
        <span className="min-w-0 flex-1 truncate text-[13px]">{name ? name : <span className="text-subtle-foreground">No file selected</span>}</span>
        {name && size ? <span className="num shrink-0 text-xs text-muted-foreground">{fmtNumber(size)} KB</span> : null}
      </div>
    </Field>
  )
}

export function DriverDocumentDialog({ open, onOpenChange, driverId, docType }: { open: boolean; onOpenChange: (o: boolean) => void; driverId: string | null; docType?: string }) {
  const driver = useDb((s) => (driverId ? s.drivers.find((d) => d.id === driverId) : undefined))
  const defaults = useMemo(() => {
    const t = docType ?? 'driver_licence'
    return {
      type: t,
      number: t === 'driver_licence' ? `DL-${driver?.licenceNo ?? ''}` : '',
      issuer: t === 'driver_licence' ? 'VID Zimbabwe' : t === 'defensive_driving' ? 'TSCZ' : t === 'medical' ? 'Occupational Health Clinic' : '',
      issueDate: todayInput(),
      expiryDate: '',
      fileName: '',
      fileSizeKb: undefined as unknown as number,
    }
  }, [open, docType, driver?.licenceNo]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FormDialog
      open={open && !!driver}
      onOpenChange={onOpenChange}
      title={`Upload document — ${driver?.name ?? ''}`}
      description="Licence, medical and training uploads also update the driver's compliance expiry dates."
      schema={docSchema}
      defaultValues={defaults}
      submitLabel="Upload document"
      onSubmit={(v) => {
        const doc = addDriverDocument(driverId!, v)
        toast.success(`${DRIVER_DOC_TYPES.find((t) => t.value === doc.type)?.label ?? 'Document'} uploaded`)
      }}
    >
      {(form) => (
        <>
          <SelectField form={form} name="type" label="Document type" required options={DRIVER_DOC_TYPES} />
          <FormGrid>
            <TextField form={form} name="number" label="Document number" required />
            <TextField form={form} name="issuer" label="Issuing authority" required />
            <DateField form={form} name="issueDate" label="Issue date" required max={todayInput()} />
            <DateField form={form} name="expiryDate" label="Expiry date" required hint={<ExpiryNote form={form} name="expiryDate" />} />
          </FormGrid>
          <FilePickerField form={form} />
        </>
      )}
    </FormDialog>
  )
}

/* ================================================================================================
 * Dialog host hook — one place to mount every driver dialog (used by the list & detail pages)
 * ============================================================================================== */

export type DriverDialogsApi = ReturnType<typeof useDriverDialogs>

type Dlg = { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'assign'; id: string } | { kind: 'status'; ids: string[]; onDone?: (r: BulkResult) => void } | { kind: 'document'; id: string; docType?: string } | null

export function useDriverDialogs(): {
  node: ReactNode
  openCreate: () => void
  openEdit: (id: string) => void
  openAssign: (id: string) => void
  openStatus: (ids: string[], onDone?: (r: BulkResult) => void) => void
  openDocument: (id: string, docType?: string) => void
} {
  const [dlg, setDlg] = useState<Dlg>(null)
  // keep the last payload mounted while the close animation plays
  const [last, setLast] = useState<Dlg>(null)
  const show = (d: Dlg) => {
    setLast(d)
    setDlg(d)
  }
  const close = (o: boolean) => {
    if (!o) setDlg(null)
  }
  const cur = dlg ?? last
  const node = (
    <>
      <DriverFormDialog open={dlg?.kind === 'create' || dlg?.kind === 'edit'} onOpenChange={close} driverId={cur?.kind === 'edit' ? cur.id : null} />
      <AssignVehicleDialog open={dlg?.kind === 'assign'} onOpenChange={close} driverId={cur?.kind === 'assign' ? cur.id : null} />
      <DriverStatusDialog open={dlg?.kind === 'status'} onOpenChange={close} driverIds={cur?.kind === 'status' ? cur.ids : []} onDone={cur?.kind === 'status' ? cur.onDone : undefined} />
      <DriverDocumentDialog open={dlg?.kind === 'document'} onOpenChange={close} driverId={cur?.kind === 'document' ? cur.id : null} docType={cur?.kind === 'document' ? cur.docType : undefined} />
    </>
  )
  return {
    node,
    openCreate: () => show({ kind: 'create' }),
    openEdit: (id) => show({ kind: 'edit', id }),
    openAssign: (id) => show({ kind: 'assign', id }),
    openStatus: (ids, onDone) => show({ kind: 'status', ids, onDone }),
    openDocument: (id, docType) => show({ kind: 'document', id, docType }),
  }
}

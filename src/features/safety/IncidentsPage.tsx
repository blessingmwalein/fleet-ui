import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Controller, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Check, ClipboardCheck, ClipboardList, Lock, Pencil, Plus, RotateCcw, Search, ShieldAlert, Trash2, Wallet } from 'lucide-react'
import type { Incident, IncidentType } from '@/types'
import { Page, PageHeader, Panel, DetailGrid, Timeline, type TimelineItem } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { Status, Plate } from '@/components/shared/Status'
import { BranchLink, DriverLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { Combobox } from '@/components/ui/command'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction, type RowAction } from '@/components/data-table/DataTable'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, Field, FormGrid, FormSection, NumberField, SelectField, SwitchField, TextAreaField, TextField, fromInputDate, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import { MiniMap, type MiniMapMarker } from '@/components/map/MiniMap'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useCan, useCurrentUser } from '@/hooks/useAuth'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { getById, useById, useOpenParam } from '@/hooks/useLookup'
import { useDriverOptions, useVehicleOptions } from '@/hooks/useOptions'
import { useMoney } from '@/hooks/useMoney'
import { INCIDENT_SEVERITY, INCIDENT_STATUS, INCIDENT_TYPE } from '@/config/status'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EventTypeChip, IncidentTypeChip } from './SafetyBits'
import { INCIDENT_TYPE_KEYS, policeReportRequired } from './safety'

const STEPS = ['reported', 'investigating', 'resolved', 'closed'] as const
type Step = (typeof STEPS)[number]
const SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const

const typeOptions = INCIDENT_TYPE_KEYS.map((k) => ({ value: k, label: INCIDENT_TYPE[k] }))
const severityOptions = SEVERITIES.map((s) => ({ value: s, label: INCIDENT_SEVERITY[s]!.label }))

// ---------------------------------------------------------------------------
// Report / edit form
// ---------------------------------------------------------------------------
const incidentSchema = z
  .object({
    vehicleId: z.string().min(1, 'Select the vehicle involved'),
    driverId: z.string().optional(),
    tripId: z.string().optional(),
    date: z.string().min(1, 'Enter when it happened'),
    location: z.string().trim().min(3, 'Describe where it happened (road, town or landmark)'),
    type: z.enum(INCIDENT_TYPE_KEYS as [IncidentType, ...IncidentType[]]),
    severity: z.enum(SEVERITIES),
    injuries: z.number({ error: 'Enter the number of injuries (0 if none)' }).int('Whole numbers only').min(0, 'Cannot be negative').max(50, 'Too many — check the figure'),
    thirdPartyInvolved: z.boolean(),
    policeReportNo: z.string().trim().max(40).optional(),
    description: z.string().trim().min(10, 'Add a short description (at least 10 characters)').max(1000, 'Keep the description under 1,000 characters'),
    estCostUsd: z.number({ error: 'Enter an estimate in USD (0 if unknown)' }).min(0, 'Cannot be negative').max(5_000_000, 'Estimate looks too high'),
    insuranceClaim: z.boolean(),
    rootCause: z.string().trim().max(400).optional(),
    actionsTaken: z.string().trim().max(600).optional(),
  })
  .refine((d) => new Date(d.date).getTime() <= Date.now() + 5 * 60_000, { path: ['date'], message: 'The incident time cannot be in the future' })
  .refine((d) => !policeReportRequired(d) || !!d.policeReportNo, { path: ['policeReportNo'], message: 'A police report number is required for injuries, major/critical severity, theft, hijack, rollover or third-party collisions' })

function VehiclePicker({ form, onPick, disabled }: { form: AnyForm; onPick: (id: string) => void; disabled?: boolean }) {
  const options = useVehicleOptions()
  const error = form.getFieldState('vehicleId', form.formState).error?.message as string | undefined
  return (
    <Field label="Vehicle" required error={error}>
      <Controller
        control={form.control}
        name="vehicleId"
        render={({ field }) => (
          <Combobox options={options} value={field.value || null} placeholder="Select vehicle…" searchPlaceholder="Search registration or model…" disabled={disabled} aria-invalid={!!error} onChange={(v) => { field.onChange(v ?? ''); if (v) onPick(v) }} />
        )}
      />
    </Field>
  )
}

function TripPicker({ form }: { form: AnyForm }) {
  const vehicleId = useWatch({ control: form.control, name: 'vehicleId' }) as string
  const trips = useDb((s) => s.trips)
  const options = useMemo(
    () =>
      trips
        .filter((t) => t.vehicleId === vehicleId)
        .sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))
        .slice(0, 20)
        .map((t) => ({ value: t.id, label: t.ref, hint: `${t.origin.city} → ${t.destination.city}` })),
    [trips, vehicleId],
  )
  return <ComboField form={form} name="tripId" label="Trip (optional)" options={options} clearable placeholder={vehicleId ? 'Link a trip…' : 'Select a vehicle first'} disabled={!vehicleId} hint="Most recent trips for this vehicle." />
}

export function IncidentFormDialog({ open, onOpenChange, incident, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; incident?: Incident | null; onCreated?: (id: string) => void }) {
  const driverOptions = useDriverOptions()
  const { user } = useCurrentUser()
  const edit = !!incident
  const defaults = incident
    ? {
        vehicleId: incident.vehicleId, driverId: incident.driverId ?? '', tripId: incident.tripId ?? '', date: toInputDateTime(incident.date), location: incident.location, type: incident.type, severity: incident.severity,
        injuries: incident.injuries, thirdPartyInvolved: incident.thirdPartyInvolved, policeReportNo: incident.policeReportNo ?? '', description: incident.description, estCostUsd: incident.estCostUsd,
        insuranceClaim: incident.insuranceClaim, rootCause: incident.rootCause ?? '', actionsTaken: incident.actionsTaken ?? '',
      }
    : {
        vehicleId: '', driverId: '', tripId: '', date: toInputDateTime(new Date().toISOString()), location: '', type: 'collision' as IncidentType, severity: 'minor' as const, injuries: 0, thirdPartyInvolved: false,
        policeReportNo: '', description: '', estCostUsd: 0, insuranceClaim: false, rootCause: '', actionsTaken: '',
      }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={edit ? `Edit incident ${incident!.ref}` : 'Report an incident'}
      description={edit ? 'Update the incident record. Status changes are made from the incident workflow.' : 'Capture an accident, breakdown, theft or near miss. The driver and live trip are filled in from the vehicle.'}
      variant="sheet"
      size="lg"
      schema={incidentSchema}
      defaultValues={defaults}
      submitLabel={edit ? 'Save changes' : 'Submit report'}
      onSubmit={(v) => {
        const veh = getById('vehicles', v.vehicleId)
        if (!veh) throw new Error('Vehicle not found')
        const live = useLive.getState().telemetry[v.vehicleId]
        const patch = {
          type: v.type, severity: v.severity, vehicleId: v.vehicleId, driverId: v.driverId || null, tripId: v.tripId || null, branchId: veh.branchId, date: fromInputDate(v.date), location: v.location,
          description: v.description, injuries: v.injuries, thirdPartyInvolved: v.thirdPartyInvolved, policeReportNo: v.policeReportNo || undefined, estCostUsd: v.estCostUsd, insuranceClaim: v.insuranceClaim,
          rootCause: v.rootCause || undefined, actionsTaken: v.actionsTaken || undefined,
        }
        if (edit) {
          const moved = incident!.vehicleId !== v.vehicleId
          useDb.getState().update('incidents', incident!.id, { ...patch, ...(moved ? { lat: live?.lat ?? veh.homeLat, lng: live?.lng ?? veh.homeLng } : {}) }, { summary: `Updated incident ${incident!.ref}` })
          toast.success(`Incident ${incident!.ref} updated`)
          return
        }
        const year = new Date(patch.date).getFullYear()
        const max = useDb.getState().incidents.reduce((m, i) => (i.ref.startsWith(`INC-${year}-`) ? Math.max(m, Number(i.ref.split('-')[2]) || 0) : m), 0)
        const ref = `INC-${year}-${String(max + 1).padStart(3, '0')}`
        const created = useDb.getState().insert(
          'incidents',
          { ...patch, ref, status: 'reported', lat: live?.lat ?? veh.homeLat, lng: live?.lng ?? veh.homeLng, reportedBy: user.name },
          { summary: `Reported incident ${ref} (${INCIDENT_TYPE[v.type]}) for ${veh.reg}` },
        )
        toast.success(`Incident ${ref} reported`, { description: `${INCIDENT_TYPE[v.type]} · ${veh.reg}`, action: onCreated ? { label: 'Open', onClick: () => onCreated(created.id) } : undefined })
        onCreated?.(created.id)
      }}
    >
      {(form) => {
        const pick = (id: string) => {
          if (edit) return
          const v = getById('vehicles', id)
          form.setValue('driverId', v?.driverId ?? '', { shouldDirty: true })
          const active = useDb.getState().trips.find((t) => t.vehicleId === id && (t.status === 'in_transit' || t.status === 'delayed'))
          form.setValue('tripId', active?.id ?? '', { shouldDirty: true })
          const live = useLive.getState().telemetry[id]
          if (live && !form.getValues('location')) form.setValue('location', live.location, { shouldDirty: true })
        }
        return (
          <>
            <FormSection title="What & who">
              <FormGrid>
                <VehiclePicker form={form} onPick={pick} />
                <ComboField form={form} name="driverId" label="Driver" options={driverOptions} clearable placeholder="Auto-filled from vehicle" searchPlaceholder="Search drivers…" />
              </FormGrid>
              <TripPicker form={form} />
              <FormGrid>
                <SelectField form={form} name="type" label="Incident type" required options={typeOptions} />
                <SelectField form={form} name="severity" label="Severity" required options={severityOptions} />
              </FormGrid>
            </FormSection>
            <FormSection title="When & where">
              <FormGrid>
                <DateField form={form} name="date" label="Date & time" withTime required />
                <TextField form={form} name="location" label="Location" required placeholder="e.g. A5, 12 km N of Kadoma" />
              </FormGrid>
            </FormSection>
            <FormSection title="Impact">
              <FormGrid>
                <NumberField form={form} name="injuries" label="Injuries" min={0} step={1} required />
                <NumberField form={form} name="estCostUsd" label="Estimated cost (USD)" prefix="$" min={0} required />
              </FormGrid>
              <FormGrid>
                <SwitchField form={form} name="thirdPartyInvolved" label="Third party involved" hint="Another vehicle, person or property" />
                <SwitchField form={form} name="insuranceClaim" label="Insurance claim" hint="Lodge a claim for this incident" />
              </FormGrid>
              <TextField form={form} name="policeReportNo" label="Police report no." placeholder="e.g. ZRP/412/26" hint="Required for injuries, major/critical severity, theft, hijack, rollover or third-party collisions." />
              <TextAreaField form={form} name="description" label="Description" required rows={4} placeholder="What happened? Include conditions, cargo and any immediate actions." />
            </FormSection>
            {edit && (
              <FormSection title="Investigation">
                <TextAreaField form={form} name="rootCause" label="Root cause" rows={2} />
                <TextAreaField form={form} name="actionsTaken" label="Actions taken" rows={2} />
              </FormSection>
            )}
          </>
        )
      }}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Investigation / resolve dialog
// ---------------------------------------------------------------------------
const findingsSchema = z.object({ rootCause: z.string().trim().max(400).optional(), actionsTaken: z.string().trim().max(600).optional() })
const resolveSchema = z.object({
  rootCause: z.string().trim().min(5, 'Record the root cause before resolving').max(400),
  actionsTaken: z.string().trim().min(5, 'Record the corrective actions taken').max(600),
})

function InvestigationDialog({ open, onOpenChange, incident, mode }: { open: boolean; onOpenChange: (o: boolean) => void; incident: Incident; mode: 'resolve' | 'findings' }) {
  const resolve = mode === 'resolve'
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={resolve ? `Resolve ${incident.ref}` : `Investigation notes — ${incident.ref}`}
      description={resolve ? 'Record the root cause and corrective actions to mark this incident as resolved.' : 'Save findings without changing the incident status.'}
      schema={resolve ? resolveSchema : findingsSchema}
      defaultValues={{ rootCause: incident.rootCause ?? '', actionsTaken: incident.actionsTaken ?? '' }}
      submitLabel={resolve ? 'Mark resolved' : 'Save findings'}
      onSubmit={(v) => {
        const patch = { rootCause: v.rootCause || undefined, actionsTaken: v.actionsTaken || undefined }
        if (resolve) {
          useDb.getState().update('incidents', incident.id, { ...patch, status: 'resolved' }, { action: 'status', summary: `Resolved incident ${incident.ref} — root cause: ${v.rootCause}` })
          toast.success(`${incident.ref} marked as resolved`)
        } else {
          useDb.getState().update('incidents', incident.id, patch, { summary: `Updated investigation findings for ${incident.ref}` })
          toast.success('Investigation notes saved')
        }
      }}
    >
      {(form) => (
        <>
          <TextAreaField form={form} name="rootCause" label="Root cause" required={resolve} rows={3} placeholder="e.g. Driver fatigue, mechanical failure, poor road conditions…" />
          <TextAreaField form={form} name="actionsTaken" label="Actions taken" required={resolve} rows={3} placeholder="e.g. Driver coached, vehicle repaired & re-inspected, claim lodged…" />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Workflow helpers
// ---------------------------------------------------------------------------
function setStatus(i: Incident, status: Step, verb: string) {
  useDb.getState().update('incidents', i.id, { status }, { action: 'status', summary: `${verb} incident ${i.ref}` })
}

async function startInvestigation(i: Incident) {
  setStatus(i, 'investigating', 'Started investigation of')
  toast.success(`Investigation started for ${i.ref}`)
}
async function closeIncident(i: Incident) {
  if (!(await confirm({ title: `Close ${i.ref}?`, description: 'Closing signs off the incident. You can reopen it later if new information emerges.', confirmLabel: 'Close incident' }))) return
  setStatus(i, 'closed', 'Closed')
  toast.success(`${i.ref} closed`)
}
async function reopenIncident(i: Incident) {
  if (!(await confirm({ title: `Reopen ${i.ref}?`, description: 'The incident returns to Investigating.', confirmLabel: 'Reopen' }))) return
  setStatus(i, 'investigating', 'Reopened')
  toast.success(`${i.ref} reopened`)
}
async function deleteIncident(i: Incident, after?: () => void) {
  if (!(await confirm({ title: `Delete ${i.ref}?`, description: 'This permanently removes the incident record and its history from the register.', confirmLabel: 'Delete', destructive: true }))) return
  after?.()
  useDb.getState().remove('incidents', i.id)
  toast.success(`${i.ref} deleted`)
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
function Stepper({ status }: { status: Step }) {
  const idx = STEPS.indexOf(status)
  return (
    <ol className="flex items-center" aria-label="Incident workflow">
      {STEPS.map((s, i) => {
        const done = i < idx
        const current = i === idx
        return (
          <li key={s} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
            <span className="flex flex-col items-center gap-1">
              <span className={cn('flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold', done ? 'border-primary bg-primary text-primary-foreground' : current ? 'border-primary bg-primary/15 text-primary ring-4 ring-primary/15' : 'border-border-strong bg-card text-subtle-foreground')}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('text-[11px] font-medium', current ? 'text-foreground' : 'text-subtle-foreground')}>{INCIDENT_STATUS[s]!.label}</span>
            </span>
            {i < STEPS.length - 1 && <span className={cn('mx-1.5 mb-4 h-px flex-1', done ? 'bg-primary' : 'bg-border')} />}
          </li>
        )
      })}
    </ol>
  )
}

function IncidentDrawer({ incident, onClose, onEdit, onSwitch }: { incident: Incident | undefined; onClose: () => void; onEdit: (i: Incident) => void; onSwitch: (id: string) => void }) {
  const money = useMoney()
  const canEdit = useCan('safety.edit')
  const canApprove = useCan('safety.approve')
  const canDelete = useCan('safety.delete')
  const auditLog = useDb((s) => s.auditLog)
  const events = useDb((s) => s.safetyEvents)
  const incidents = useDb((s) => s.incidents)
  const [dialog, setDialog] = useState<'resolve' | 'findings' | null>(null)

  const markers = useMemo<MiniMapMarker[]>(() => (incident ? [{ id: incident.id, lat: incident.lat, lng: incident.lng, kind: 'incident', label: incident.ref }] : []), [incident?.id, incident?.lat, incident?.lng, incident?.ref]) // eslint-disable-line react-hooks/exhaustive-deps
  const activity = useMemo<TimelineItem[]>(() => {
    if (!incident) return []
    const items: TimelineItem[] = auditLog
      .filter((a) => a.entityId === incident.id && a.action !== 'create')
      .reverse()
      .map((a) => ({ id: a.id, title: a.summary, description: a.userName, time: fmtDateTime(a.at), tone: a.action === 'status' ? ('primary' as const) : ('default' as const) }))
    return [{ id: 'reported', title: `Incident reported by ${incident.reportedBy}`, description: incident.location, time: fmtDateTime(incident.date), tone: 'danger' as const }, ...items]
  }, [auditLog, incident])
  const tripEvents = useMemo(() => (incident?.tripId ? events.filter((e) => e.tripId === incident.tripId).slice(-4).reverse() : []), [events, incident?.tripId])
  const related = useMemo(() => (incident ? incidents.filter((i) => i.id !== incident.id && (i.vehicleId === incident.vehicleId || (incident.driverId && i.driverId === incident.driverId))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) : []), [incidents, incident])

  const status = (incident?.status ?? 'reported') as Step
  return (
    <>
      <Sheet open={!!incident} onOpenChange={(o) => !o && onClose()}>
        <SheetContent size="lg">
          {incident && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <span className="num">{incident.ref}</span>
                  <Status kind="severity" value={incident.severity} dot={false} />
                  <Status kind="incident" value={incident.status} />
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-x-2">
                  <IncidentTypeChip type={incident.type} label={INCIDENT_TYPE[incident.type]} />
                  <span>· {fmtDateTime(incident.date)} · {timeAgo(incident.date)}</span>
                </SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-5">
                <Stepper status={status} />
                <p className="rounded-md border border-border bg-surface-2/50 p-3 text-[13px] leading-relaxed">{incident.description}</p>
                <DetailGrid
                  columns={2}
                  items={[
                    { label: 'Vehicle', value: <VehicleLink id={incident.vehicleId} /> },
                    { label: 'Driver', value: <DriverLink id={incident.driverId} avatar fallback="Unassigned" /> },
                    { label: 'Trip', value: incident.tripId ? <TripLink id={incident.tripId} /> : '—' },
                    { label: 'Branch', value: <BranchLink id={incident.branchId} /> },
                    { label: 'Location', value: incident.location },
                    { label: 'Reported by', value: incident.reportedBy },
                    { label: 'Injuries', value: incident.injuries ? <Badge tone="danger">{incident.injuries}</Badge> : 'None' },
                    { label: 'Third party', value: incident.thirdPartyInvolved ? 'Involved' : 'No' },
                    { label: 'Police report', value: incident.policeReportNo ?? '—' },
                    { label: 'Estimated cost', value: <span className="num font-medium">{money(incident.estCostUsd)}</span> },
                    { label: 'Insurance claim', value: incident.insuranceClaim ? <Badge tone="info">Claim lodged</Badge> : <span className="text-muted-foreground">No claim</span> },
                  ]}
                />
                <Panel
                  title="Investigation" description="Root cause & corrective actions"
                  actions={canEdit && <Button size="xs" variant="outline" onClick={() => setDialog('findings')}><Pencil /> {incident.rootCause || incident.actionsTaken ? 'Edit' : 'Record'}</Button>}
                >
                  {incident.rootCause || incident.actionsTaken ? (
                    <dl className="space-y-3 text-[13px]">
                      <div><dt className="label-xs mb-0.5">Root cause</dt><dd>{incident.rootCause ?? <span className="text-muted-foreground">Not recorded</span>}</dd></div>
                      <div><dt className="label-xs mb-0.5">Actions taken</dt><dd>{incident.actionsTaken ?? <span className="text-muted-foreground">Not recorded</span>}</dd></div>
                    </dl>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">No findings recorded yet. Record the root cause and actions to resolve this incident.</p>
                  )}
                </Panel>
                <div>
                  <h3 className="label-xs mb-1.5">Location</h3>
                  <MiniMap height={200} markers={markers} zoom={12} />
                  <p className="mt-1 text-xs text-muted-foreground">{incident.location} · {incident.lat.toFixed(4)}, {incident.lng.toFixed(4)}</p>
                </div>
                {tripEvents.length > 0 && (
                  <Panel title="Safety events on this trip" description="Telematics events recorded during the same journey" flush>
                    <ul className="divide-y divide-border/70">
                      {tripEvents.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 px-3.5 py-2"><EventTypeChip type={e.type} /><span className="num text-xs text-muted-foreground">{fmtDateTime(e.timestamp)}</span></li>
                      ))}
                    </ul>
                  </Panel>
                )}
                {related.length > 0 && (
                  <Panel title="Related incidents" description="Same vehicle or driver" flush>
                    <ul className="divide-y divide-border/70">
                      {related.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] hover:bg-accent/40" onClick={() => onSwitch(r.id)}>
                            <span className="flex items-center gap-2"><span className="num font-medium">{r.ref}</span><span className="text-muted-foreground">{INCIDENT_TYPE[r.type]}</span></span>
                            <Status kind="incident" value={r.status} dot={false} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
                <div>
                  <h3 className="label-xs mb-2">Activity</h3>
                  <Timeline items={activity} />
                </div>
              </SheetBody>
              <SheetFooter>
                {canDelete && <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger" onClick={() => deleteIncident(incident, onClose)}><Trash2 /> Delete</Button>}
                {canEdit && <Button variant="outline" onClick={() => onEdit(incident)}><Pencil /> Edit</Button>}
                {canEdit && (status === 'resolved' || status === 'closed') && <Button variant="outline" onClick={() => reopenIncident(incident)}><RotateCcw /> Reopen</Button>}
                {canEdit && status === 'reported' && <Button onClick={() => startInvestigation(incident)}><Search /> Start investigation</Button>}
                {canEdit && status === 'investigating' && <Button onClick={() => setDialog('resolve')}><ClipboardCheck /> Mark resolved</Button>}
                {canApprove && status === 'resolved' && <Button onClick={() => closeIncident(incident)}><Lock /> Close incident</Button>}
              </SheetFooter>
              <InvestigationDialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} incident={incident} mode={dialog ?? 'findings'} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
interface IncRow extends Incident {
  typeLabel: string
  severityLabel: string
  statusLabel: string
  vehicleReg: string
  driverName: string
  branchName: string
  claimLabel: string
}

export default function IncidentsPage() {
  const incidents = useDb((s) => s.incidents)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branches = useDb((s) => s.branches)
  const { scope } = useBranchScope()
  const range = useDateRange()
  const money = useMoney()
  const canCreate = useCan('safety.create')
  const canEdit = useCan('safety.edit')
  const canApprove = useCan('safety.approve')
  const canDelete = useCan('safety.delete')
  const getIncident = useById('incidents')
  const [openId, setOpenId] = useOpenParam()
  const [params, setParams] = useSearchParams()
  const [period, setPeriod] = useState<'all' | 'range'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Incident | null>(null)

  // ?new=1 deep link (top-bar Create menu / command palette)
  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) { setEditing(null); setFormOpen(true) }
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
  }, [params, setParams, canCreate])

  const rows = useMemo<IncRow[]>(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const dById = new Map(drivers.map((d) => [d.id, d]))
    const bById = new Map(branches.map((b) => [b.id, b]))
    return scope(incidents)
      .filter((i) => period === 'all' || range.inRange(i.date))
      .map((i) => ({
        ...i,
        typeLabel: INCIDENT_TYPE[i.type],
        severityLabel: INCIDENT_SEVERITY[i.severity]!.label,
        statusLabel: INCIDENT_STATUS[i.status]!.label,
        vehicleReg: vById.get(i.vehicleId)?.reg ?? '—',
        driverName: (i.driverId && dById.get(i.driverId)?.name) || 'Unassigned',
        branchName: bById.get(i.branchId)?.name ?? '—',
        claimLabel: i.insuranceClaim ? 'Claim lodged' : 'No claim',
      }))
  }, [incidents, vehicles, drivers, branches, scope, period, range])

  const open = rows.filter((r) => r.status === 'reported' || r.status === 'investigating')
  const severeOpen = open.filter((r) => r.severity === 'major' || r.severity === 'critical')
  const costOpen = open.reduce((s, r) => s + r.estCostUsd, 0)
  const claimsOpen = rows.filter((r) => r.insuranceClaim && r.status !== 'closed').length
  const injuries = rows.reduce((s, r) => s + r.injuries, 0)

  const rowActions = (r: Incident): RowAction[] => [
    { label: 'Open details', icon: <ClipboardList />, onClick: () => setOpenId(r.id) },
    { label: 'Start investigation', icon: <Search />, onClick: () => startInvestigation(r), hidden: !canEdit || r.status !== 'reported' },
    { label: 'Mark resolved', icon: <ClipboardCheck />, onClick: () => setOpenId(r.id), hidden: !canEdit || r.status !== 'investigating' },
    { label: 'Close incident', icon: <Lock />, onClick: () => closeIncident(r), hidden: !canApprove || r.status !== 'resolved' },
    { label: 'Reopen', icon: <RotateCcw />, onClick: () => reopenIncident(r), hidden: !canEdit || (r.status !== 'closed' && r.status !== 'resolved') },
    { label: 'Edit', icon: <Pencil />, onClick: () => { setEditing(r); setFormOpen(true) }, hidden: !canEdit, separatorBefore: true },
    { label: 'Delete', icon: <Trash2 />, onClick: () => deleteIncident(r), destructive: true, hidden: !canDelete },
  ]

  const columns = useMemo<ColumnDef<IncRow, any>[]>(
    () => [
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Reference', size: 120, cell: ({ row }) => <span className="num font-medium">{row.original.ref}</span> },
      { id: 'date', accessorFn: (r) => r.date, header: 'Date', size: 140, meta: { label: 'Date', exportValue: (r) => fmtDateTime(r.date) }, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.date)}</span> },
      { id: 'type', accessorFn: (r) => r.typeLabel, header: 'Type', size: 130, filterFn: 'inArray', cell: ({ row }) => <IncidentTypeChip type={row.original.type} label={row.original.typeLabel} /> },
      { id: 'severity', accessorFn: (r) => r.severityLabel, header: 'Severity', size: 100, filterFn: 'inArray', sortingFn: (a, b) => SEVERITIES.indexOf(a.original.severity) - SEVERITIES.indexOf(b.original.severity), cell: ({ row }) => <Status kind="severity" value={row.original.severity} dot={false} /> },
      { id: 'status', accessorFn: (r) => r.statusLabel, header: 'Status', size: 125, filterFn: 'inArray', cell: ({ row }) => <Status kind="incident" value={row.original.status} /> },
      { id: 'vehicle', accessorFn: (r) => r.vehicleReg, header: 'Vehicle', size: 110, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, meta: { hideBelow: 'md' }, cell: ({ row }) => <DriverLink id={row.original.driverId} fallback="Unassigned" /> },
      { id: 'location', accessorFn: (r) => r.location, header: 'Location', size: 220, meta: { hideBelow: 'lg' }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.location}</span> },
      { id: 'injuries', accessorFn: (r) => r.injuries, header: 'Injuries', size: 80, meta: { align: 'right', hideBelow: 'xl' } },
      { id: 'cost', accessorFn: (r) => r.estCostUsd, header: 'Est. cost', size: 100, meta: { align: 'right', exportValue: (r) => r.estCostUsd }, cell: ({ row }) => money(row.original.estCostUsd) },
      { id: 'claim', accessorFn: (r) => r.claimLabel, header: 'Claim', size: 110, meta: { hideBelow: 'xl' }, cell: ({ row }) => (row.original.insuranceClaim ? <Badge tone="info">Lodged</Badge> : <span className="text-subtle-foreground">—</span>) },
      { id: 'branch', accessorFn: (r) => r.branchName, header: 'Branch', size: 130, filterFn: 'inArray', meta: { hideBelow: 'xl' } },
      actionsColumn<IncRow>(rowActions),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, canEdit, canApprove, canDelete, setOpenId],
  )

  const bulkActions: BulkAction<IncRow>[] = [
    ...(canEdit
      ? [
          {
            label: 'Start investigation', icon: <Search />,
            onClick: (sel: IncRow[], clear: () => void) => {
              const t = sel.filter((r) => r.status === 'reported')
              if (!t.length) return toast.error('None of the selected incidents are awaiting investigation')
              useDb.getState().updateMany('incidents', t.map((r) => r.id), { status: 'investigating' }, { action: 'status', summary: `Started investigation of ${t.length} incident${t.length === 1 ? '' : 's'}` })
              toast.success(`Investigation started for ${t.length} incident${t.length === 1 ? '' : 's'}`)
              clear()
            },
          },
        ]
      : []),
    ...(canApprove
      ? [
          {
            label: 'Close resolved', icon: <Lock />,
            onClick: async (sel: IncRow[], clear: () => void) => {
              const t = sel.filter((r) => r.status === 'resolved')
              if (!t.length) return toast.error('Only resolved incidents can be closed')
              if (!(await confirm({ title: `Close ${t.length} incident${t.length === 1 ? '' : 's'}?`, description: 'Resolved incidents will be signed off as closed.', confirmLabel: 'Close' }))) return
              useDb.getState().updateMany('incidents', t.map((r) => r.id), { status: 'closed' }, { action: 'status', summary: `Closed ${t.length} resolved incident${t.length === 1 ? '' : 's'}` })
              toast.success(`${t.length} incident${t.length === 1 ? '' : 's'} closed`)
              clear()
            },
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            label: 'Delete', icon: <Trash2 />, destructive: true,
            onClick: async (sel: IncRow[], clear: () => void) => {
              if (!(await confirm({ title: `Delete ${sel.length} incident${sel.length === 1 ? '' : 's'}?`, description: 'This permanently removes the selected records.', confirmLabel: 'Delete', destructive: true }))) return
              useDb.getState().removeMany('incidents', sel.map((r) => r.id))
              toast.success(`${sel.length} incident${sel.length === 1 ? '' : 's'} deleted`)
              clear()
            },
          },
        ]
      : []),
  ]

  const unique = (f: (r: IncRow) => string) => [...new Set(rows.map(f))].sort().map((v) => ({ value: v, label: v }))
  const facets = [
    { columnId: 'type', label: 'Type', options: INCIDENT_TYPE_KEYS.map((k) => ({ value: INCIDENT_TYPE[k], label: INCIDENT_TYPE[k] })) },
    { columnId: 'severity', label: 'Severity', options: SEVERITIES.map((s) => ({ value: INCIDENT_SEVERITY[s]!.label, label: INCIDENT_SEVERITY[s]!.label })) },
    { columnId: 'status', label: 'Status', options: STEPS.map((s) => ({ value: INCIDENT_STATUS[s]!.label, label: INCIDENT_STATUS[s]!.label })) },
    { columnId: 'branch', label: 'Branch', options: unique((r) => r.branchName) },
  ]

  const incident = openId ? getIncident(openId) : undefined
  useEffect(() => {
    if (openId && !incident && incidents.length) setOpenId(null)
  }, [openId, incident, incidents.length, setOpenId])

  return (
    <Page>
      <PageHeader
        title="Incidents"
        description="Accident, breakdown, theft and near-miss register with an investigation workflow: Reported → Investigating → Resolved → Closed."
        actions={canCreate && <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}><Plus /> Report incident</Button>}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Open incidents" icon={ClipboardList} value={open.length} status={open.length ? 'warning' : 'success'} hint="Reported or under investigation" />
        <KpiCard label="Major / critical open" icon={ShieldAlert} value={severeOpen.length} status={severeOpen.length ? 'danger' : 'success'} />
        <KpiCard label="Open exposure" icon={Wallet} value={money(costOpen, { compact: true })} hint="Estimated cost of open incidents" />
        <KpiCard label="Insurance claims" icon={Ban} value={claimsOpen} unit="not closed" />
        <KpiCard label="Injuries recorded" icon={ShieldAlert} value={injuries} status={injuries ? 'danger' : undefined} hint={period === 'range' ? range.label : 'All time'} />
      </div>

      <DataTable<IncRow>
        data={rows}
        columns={columns}
        tableId="safety-incidents"
        getRowId={(r) => r.id}
        searchPlaceholder="Search reference, vehicle, driver, location…"
        facets={facets}
        exportName="incidents"
        selectable
        bulkActions={bulkActions}
        defaultSort={[{ id: 'date', desc: true }]}
        defaultHidden={['branch']}
        onRowClick={(r) => setOpenId(r.id)}
        toolbar={<Segmented size="sm" aria-label="Period" value={period} onChange={setPeriod} options={[{ value: 'all', label: 'All time' }, { value: 'range', label: range.label }]} />}
        actions={canCreate && <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}><Plus /> Report</Button>}
        emptyTitle="No incidents match"
        emptyDescription="Adjust the filters, or report a new incident."
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><span className="num font-medium">{r.ref}</span><Status kind="incident" value={r.status} /></div>
            <div className="flex items-center justify-between gap-2"><IncidentTypeChip type={r.type} label={r.typeLabel} /><Status kind="severity" value={r.severity} dot={false} /></div>
            <p className="text-xs text-muted-foreground"><Plate>{r.vehicleReg}</Plate> · {r.driverName} · {timeAgo(r.date)}</p>
            <p className="truncate text-xs text-subtle-foreground">{r.location}</p>
          </div>
        )}
        rowClassName={(r) => (r.severity === 'critical' && r.status !== 'closed' ? 'bg-danger/5' : undefined)}
      />

      <IncidentDrawer incident={incident} onClose={() => setOpenId(null)} onSwitch={setOpenId} onEdit={(i) => { setEditing(i); setFormOpen(true) }} />
      <IncidentFormDialog open={formOpen} onOpenChange={setFormOpen} incident={editing} onCreated={(id) => setOpenId(id)} />
    </Page>
  )
}

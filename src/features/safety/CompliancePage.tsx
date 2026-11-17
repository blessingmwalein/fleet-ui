import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Controller, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { BellOff, BellRing, CalendarClock, ClipboardCheck, Download, FilePlus2, FileText, FileWarning, RefreshCw, Send, ShieldCheck, Trash2, Upload, UserCheck } from 'lucide-react'
import type { DocumentType } from '@/types'
import { Page, PageHeader, Panel, DetailGrid, Timeline, type TimelineItem } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { ExpiryBadge, Plate } from '@/components/shared/Status'
import { DriverLink, VehicleLink, BranchLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Input } from '@/components/ui/form-controls'
import { Segmented } from '@/components/ui/segmented'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction, type RowAction } from '@/components/data-table/DataTable'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, Field, FormGrid, TextField, fromInputDate, type AnyForm } from '@/components/forms/fields'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import { useCan, useCurrentUser } from '@/hooks/useAuth'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useDriverOptions, useVehicleOptions } from '@/hooks/useOptions'
import { useOpenParam } from '@/hooks/useLookup'
import { DOCUMENT_TYPE } from '@/config/status'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/form-controls'
import {
  CORE_VEHICLE_DOCS, DEFAULT_ISSUER, DOC_GROUPS, DOC_TERM_DAYS, DRIVER_DOC_TYPES, VEHICLE_DOC_TYPES, isSnoozed, mirrorToDriver, sendReminders, summarise, useDocRows, useReminderStore, type DocRow,
} from './compliance'
import { useNow } from './useSafetyData'

const fmtBytesKb = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`)
const today = () => new Date().toISOString().slice(0, 10)
const addDaysIso = (isoDate: string, days: number) => new Date(new Date(`${isoDate}T00:00:00`).getTime() + days * 864e5).toISOString().slice(0, 10)

// ---------------------------------------------------------------------------
// File field (upload placeholder — records name & size only)
// ---------------------------------------------------------------------------
function FileField({ form, label = 'Certificate file' }: { form: AnyForm; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const error = form.getFieldState('fileName', form.formState).error?.message as string | undefined
  return (
    <Field label={label} required error={error} hint="Choose a scan or PDF. In this demo only the file name and size are recorded.">
      <Controller
        control={form.control}
        name="fileName"
        render={({ field }) => (
          <div className="flex gap-2">
            <Input value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} placeholder="certificate.pdf" aria-invalid={!!error} />
            <Button type="button" variant="outline" onClick={() => ref.current?.click()}><Upload /> Choose</Button>
            <input
              ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                form.setValue('fileName', f.name, { shouldValidate: true, shouldDirty: true })
                form.setValue('fileSizeKb', Math.max(1, Math.round(f.size / 1024)))
              }}
            />
          </div>
        )}
      />
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------
const renewSchema = z
  .object({
    number: z.string().trim().min(3, 'Enter the new certificate / policy number').max(40),
    issueDate: z.string().min(1, 'Enter the issue date'),
    expiryDate: z.string().min(1, 'Enter the new expiry date'),
    fileName: z.string().trim().min(3, 'Attach the renewed certificate'),
    fileSizeKb: z.number().optional(),
  })
  .refine((d) => d.expiryDate > d.issueDate, { path: ['expiryDate'], message: 'Expiry must be after the issue date' })
  .refine((d) => !d.expiryDate || new Date(`${d.expiryDate}T23:59:59`).getTime() > Date.now(), { path: ['expiryDate'], message: 'The new expiry date must be in the future' })

function RenewDialog({ doc, onOpenChange }: { doc: DocRow | null; onOpenChange: (o: boolean) => void }) {
  const { user } = useCurrentUser()
  const d = doc
  return (
    <FormDialog
      open={!!d}
      onOpenChange={onOpenChange}
      title={d ? `Renew ${d.typeLabel}` : 'Renew document'}
      description={d ? `${d.entityName} · currently ${d.state === 'expired' ? `expired ${-d.days} days ago` : d.state === 'expiring' ? `expiring in ${d.days} days` : 'valid'}` : undefined}
      schema={renewSchema}
      defaultValues={{
        number: d?.number ?? '', issueDate: today(), expiryDate: addDaysIso(today(), d ? DOC_TERM_DAYS[d.type] : 365), fileName: d ? `${d.type}_${d.entityId}_renewal.pdf` : '', fileSizeKb: undefined,
      }}
      submitLabel="Renew document"
      onSubmit={(v) => {
        if (!d) return
        const expiryDate = fromInputDate(v.expiryDate)
        useDb.getState().update(
          'documents', d.id,
          { number: v.number, issueDate: fromInputDate(v.issueDate), expiryDate, fileName: v.fileName, fileSizeKb: v.fileSizeKb ?? 420, uploadedAt: new Date().toISOString(), uploadedBy: user.name },
          { summary: `Renewed ${d.typeLabel} ${v.number} for ${d.entityName} — valid until ${fmtDate(expiryDate)}` },
        )
        mirrorToDriver({ entityType: d.entityType, entityId: d.entityId, type: d.type, expiryDate })
        useReminderStore.getState().unsnooze(d.id)
        toast.success(`${d.typeLabel} renewed`, { description: `${d.entityName} is valid until ${fmtDate(expiryDate)}.` })
      }}
    >
      {(form) => (
        <>
          <TextField form={form} name="number" label="Certificate / policy number" required />
          <FormGrid>
            <DateField form={form} name="issueDate" label="Issue date" required />
            <DateField form={form} name="expiryDate" label="New expiry date" required />
          </FormGrid>
          <FileField form={form} label="Renewed certificate" />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Add document
// ---------------------------------------------------------------------------
const addSchema = z
  .object({
    kind: z.enum(['vehicle', 'driver']),
    entityId: z.string().min(1, 'Select the vehicle or driver'),
    type: z.string().min(1, 'Choose a document type'),
    number: z.string().trim().min(3, 'Enter the certificate / policy number').max(40),
    issuer: z.string().trim().min(2, 'Enter the issuing authority').max(80),
    issueDate: z.string().min(1, 'Enter the issue date'),
    expiryDate: z.string().min(1, 'Enter the expiry date'),
    fileName: z.string().trim().min(3, 'Attach the document'),
    fileSizeKb: z.number().optional(),
  })
  .refine((d) => d.expiryDate > d.issueDate, { path: ['expiryDate'], message: 'Expiry must be after the issue date' })

function AddFields({ form }: { form: AnyForm }) {
  const kind = useWatch({ control: form.control, name: 'kind' }) as 'vehicle' | 'driver'
  const vehicleOptions = useVehicleOptions()
  const driverOptions = useDriverOptions()
  const types = kind === 'vehicle' ? VEHICLE_DOC_TYPES : DRIVER_DOC_TYPES
  const applyType = (t: DocumentType) => {
    form.setValue('type', t, { shouldValidate: true })
    form.setValue('issuer', DEFAULT_ISSUER[t])
    form.setValue('expiryDate', addDaysIso(form.getValues('issueDate') || today(), DOC_TERM_DAYS[t]))
  }
  const typeError = form.getFieldState('type', form.formState).error?.message as string | undefined
  return (
    <>
      <Field label="Applies to" required>
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Segmented
              size="md" aria-label="Entity type" value={field.value} options={[{ value: 'vehicle', label: 'Vehicle' }, { value: 'driver', label: 'Driver' }]}
              onChange={(v) => { field.onChange(v); form.setValue('entityId', ''); form.setValue('type', ''); form.setValue('issuer', '') }}
            />
          )}
        />
      </Field>
      <ComboField form={form} name="entityId" label={kind === 'vehicle' ? 'Vehicle' : 'Driver'} required options={kind === 'vehicle' ? vehicleOptions : driverOptions} placeholder={kind === 'vehicle' ? 'Select vehicle…' : 'Select driver…'} />
      <Field label="Document type" required error={typeError}>
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <Select value={field.value || ''} onValueChange={(v) => applyType(v as DocumentType)}>
              <SelectTrigger aria-invalid={!!typeError}><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{DOCUMENT_TYPE[t]}</SelectItem>)}</SelectContent>
            </Select>
          )}
        />
      </Field>
      <FormGrid>
        <TextField form={form} name="number" label="Certificate / policy number" required />
        <TextField form={form} name="issuer" label="Issuing authority" required />
        <DateField form={form} name="issueDate" label="Issue date" required />
        <DateField form={form} name="expiryDate" label="Expiry date" required />
      </FormGrid>
      <FileField form={form} label="Document file" />
    </>
  )
}

function AddDocumentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { user } = useCurrentUser()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add compliance document"
      description="Register an insurance policy, licence, permit or certificate for a vehicle or driver."
      schema={addSchema}
      defaultValues={{ kind: 'vehicle' as const, entityId: '', type: '', number: '', issuer: '', issueDate: today(), expiryDate: addDaysIso(today(), 365), fileName: '', fileSizeKb: undefined }}
      submitLabel="Add document"
      onSubmit={(v) => {
        const type = v.type as DocumentType
        const db = useDb.getState()
        const existing = db.documents.find((x) => x.entityType === v.kind && x.entityId === v.entityId && x.type === type)
        const name = v.kind === 'vehicle' ? db.vehicles.find((x) => x.id === v.entityId)?.reg : db.drivers.find((x) => x.id === v.entityId)?.name
        if (existing) throw new Error(`${DOCUMENT_TYPE[type]} already on file for ${name} (expires ${fmtDate(existing.expiryDate)}). Use Renew on the existing record instead.`)
        const expiryDate = fromInputDate(v.expiryDate)
        const created = db.insert(
          'documents',
          { entityType: v.kind, entityId: v.entityId, type, number: v.number, issuer: v.issuer, issueDate: fromInputDate(v.issueDate), expiryDate, fileName: v.fileName, fileSizeKb: v.fileSizeKb ?? 420, uploadedAt: new Date().toISOString(), uploadedBy: user.name },
          { summary: `Added ${DOCUMENT_TYPE[type]} ${v.number} for ${name}` },
        )
        mirrorToDriver({ entityType: v.kind, entityId: v.entityId, type, expiryDate })
        toast.success(`${DOCUMENT_TYPE[type]} added`, { description: `${name} · valid until ${fmtDate(expiryDate)}` })
        onCreated(created.id)
      }}
    >
      {(form) => <AddFields form={form} />}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------
async function deleteDocs(rows: DocRow[], after?: () => void) {
  const single = rows.length === 1
  if (!(await confirm({ title: single ? `Delete ${rows[0]!.typeLabel}?` : `Delete ${rows.length} documents?`, description: single ? `${rows[0]!.entityName} · ${rows[0]!.number} will be removed from the register. This cannot be undone.` : 'The selected documents will be removed from the register.', confirmLabel: 'Delete', destructive: true }))) return
  after?.()
  if (single) useDb.getState().remove('documents', rows[0]!.id, { summary: `Deleted ${rows[0]!.typeLabel} ${rows[0]!.number} (${rows[0]!.entityName})` })
  else useDb.getState().removeMany('documents', rows.map((r) => r.id), { summary: `Deleted ${rows.length} compliance documents` })
  toast.success(single ? 'Document deleted' : `${rows.length} documents deleted`)
}

function DocumentDrawer({ doc, all, onClose, onRenew, onSwitch }: { doc: DocRow | undefined; all: DocRow[]; onClose: () => void; onRenew: (d: DocRow) => void; onSwitch: (id: string) => void }) {
  const canEdit = useCan('safety.edit')
  const canDelete = useCan('safety.delete')
  const auditLog = useDb((s) => s.auditLog)
  const sent = useReminderStore((s) => s.sent)
  const snoozed = useReminderStore((s) => s.snoozed)
  const now = useNow(60_000)
  const history = useMemo<TimelineItem[]>(() => {
    if (!doc) return []
    return auditLog.filter((a) => a.entityId === doc.id).slice(0, 8).map((a) => ({ id: a.id, title: a.summary, description: a.userName, time: fmtDateTime(a.at), tone: a.summary.startsWith('Compliance reminder') ? ('warning' as const) : ('default' as const) }))
  }, [auditLog, doc])
  const siblings = useMemo(() => (doc ? all.filter((r) => r.entityType === doc.entityType && r.entityId === doc.entityId) : []), [all, doc])
  const missing = doc?.entityType === 'vehicle' ? CORE_VEHICLE_DOCS.filter((t) => !siblings.some((s) => s.type === t)) : []
  const issued = doc ? new Date(doc.issueDate).getTime() : 0
  const expiry = doc ? new Date(doc.expiryDate).getTime() : 0
  const elapsed = doc ? Math.max(0, Math.min(100, ((now - issued) / Math.max(1, expiry - issued)) * 100)) : 0
  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        {doc && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">{doc.typeLabel}<ExpiryBadge iso={doc.expiryDate} /></SheetTitle>
              <SheetDescription><span className="num">{doc.number}</span> · {doc.entityName}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground"><span>{fmtDate(doc.issueDate)}</span><span className="font-medium text-foreground">{doc.state === 'expired' ? `Expired ${-doc.days} days ago` : `${doc.days} days remaining`}</span><span>{fmtDate(doc.expiryDate)}</span></div>
                <Progress value={elapsed} indicatorClassName={doc.state === 'expired' ? 'bg-danger' : doc.state === 'expiring' ? 'bg-warning' : 'bg-success'} aria-label="Validity elapsed" />
              </div>
              <DetailGrid
                items={[
                  { label: doc.kind, value: doc.entityType === 'vehicle' ? <VehicleLink id={doc.entityId} /> : <DriverLink id={doc.entityId} avatar /> },
                  { label: 'Branch', value: doc.branchId ? <BranchLink id={doc.branchId} /> : '—' },
                  { label: 'Issuer', value: doc.issuer },
                  { label: 'Status', value: <Badge tone={doc.tone}>{doc.stateLabel}</Badge> },
                  { label: 'Issued', value: fmtDate(doc.issueDate) },
                  { label: 'Expires', value: fmtDate(doc.expiryDate) },
                  { label: 'Uploaded', value: `${fmtDate(doc.uploadedAt)} by ${doc.uploadedBy}` },
                  { label: 'Reminders', value: isSnoozed(snoozed, doc.id, now) ? `Snoozed until ${fmtDate(snoozed[doc.id])}` : sent[doc.id] ? `Last sent ${timeAgo(sent[doc.id])}` : 'None sent' },
                ]}
              />
              <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2/50 p-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-surface-3 text-muted-foreground"><FileText className="size-4.5" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{doc.fileName}</p><p className="text-xs text-muted-foreground">{fmtBytesKb(doc.fileSizeKb)}</p></div>
                <Button size="sm" variant="outline" onClick={() => toast.info('Document preview is not available in this demo', { description: doc.fileName })}><Download /> Download</Button>
              </div>
              <Panel title={`${doc.kind} compliance checklist`} description={doc.entityName} flush>
                <ul className="divide-y divide-border/70">
                  {siblings.sort((a, b) => a.days - b.days).map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => onSwitch(s.id)} className={cn('flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] hover:bg-accent/40', s.id === doc.id && 'bg-accent/30')}>
                        <span>{s.typeLabel}</span><ExpiryBadge iso={s.expiryDate} />
                      </button>
                    </li>
                  ))}
                  {missing.map((t) => (
                    <li key={t} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]"><span>{DOCUMENT_TYPE[t]}</span><Badge tone="danger">Missing</Badge></li>
                  ))}
                </ul>
              </Panel>
              {history.length > 0 && <div><h3 className="label-xs mb-2">History</h3><Timeline items={history} /></div>}
            </SheetBody>
            <SheetFooter>
              {canDelete && <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger" onClick={() => deleteDocs([doc], onClose)}><Trash2 /> Delete</Button>}
              {canEdit && doc.state !== 'valid' && <Button variant="outline" onClick={() => sendReminders([doc])}><Send /> Send reminder</Button>}
              {canEdit && <Button onClick={() => { onRenew(doc) }}><RefreshCw /> Renew</Button>}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Reminders & inspections panels
// ---------------------------------------------------------------------------
function RemindersPanel({ rows, onOpen }: { rows: DocRow[]; onOpen: (id: string) => void }) {
  const canEdit = useCan('safety.edit')
  const sent = useReminderStore((s) => s.sent)
  const snoozed = useReminderStore((s) => s.snoozed)
  const now = useNow(60_000)
  const [view, setView] = useState<'due' | 'snoozed'>('due')
  const attention = useMemo(() => rows.filter((r) => r.state === 'expired' || r.state === 'expiring').sort((a, b) => a.days - b.days), [rows])
  const due = attention.filter((r) => !isSnoozed(snoozed, r.id, now))
  const sn = attention.filter((r) => isSnoozed(snoozed, r.id, now))
  const list = view === 'due' ? due : sn
  const snooze = (r: DocRow, days: number) => {
    const until = new Date(Date.now() + days * 864e5).toISOString()
    useReminderStore.getState().snooze(r.id, until)
    useDb.getState().update('documents', r.id, {}, { action: 'system', summary: `Snoozed compliance reminder for ${r.typeLabel} ${r.number} (${r.entityName}) for ${days} day${days === 1 ? '' : 's'}` })
    toast.success(`Reminder snoozed for ${days} day${days === 1 ? '' : 's'}`, { description: `${r.typeLabel} · ${r.entityName}` })
  }
  const sendAll = async () => {
    if (!(await confirm({ title: `Send ${due.length} reminder${due.length === 1 ? '' : 's'}?`, description: 'Every expired or expiring document that is not snoozed will notify its owner by email and in-app.', confirmLabel: 'Send all' }))) return
    sendReminders(due)
  }
  return (
    <Panel
      title="Compliance reminders" description={`${due.length} due · ${sn.length} snoozed`} flush
      actions={<>{canEdit && due.length > 0 && <Button size="xs" variant="outline" onClick={sendAll}><BellRing /> Send all</Button>}</>}
    >
      <div className="border-b border-border px-3.5 py-2"><Segmented size="xs" aria-label="Reminder view" value={view} onChange={setView} options={[{ value: 'due', label: `Due (${due.length})` }, { value: 'snoozed', label: `Snoozed (${sn.length})` }]} /></div>
      {list.length === 0 ? (
        <EmptyState compact icon={ShieldCheck} title={view === 'due' ? 'No reminders due' : 'Nothing snoozed'} description={view === 'due' ? 'All documents are valid or snoozed.' : 'Snoozed reminders appear here.'} />
      ) : (
        <ul className="max-h-[27rem] divide-y divide-border/70 overflow-y-auto">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3.5 py-2">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(r.id)}>
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">{r.typeLabel}<ExpiryBadge iso={r.expiryDate} /></p>
                <p className="truncate text-xs text-muted-foreground">{r.entityName} · {r.contactName}</p>
                <p className="truncate text-[11px] text-subtle-foreground">{view === 'snoozed' ? `Snoozed until ${fmtDate(snoozed[r.id])}` : sent[r.id] ? `Last reminded ${timeAgo(sent[r.id])}` : 'No reminder sent yet'}</p>
              </button>
              {canEdit && view === 'due' && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="icon-sm" variant="ghost" aria-label={`Send reminder for ${r.typeLabel} ${r.entityName}`} onClick={() => sendReminders([r])}><Send /></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Snooze reminder for ${r.typeLabel} ${r.entityName}`}><BellOff /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => snooze(r, 1)}>Snooze 1 day</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => snooze(r, 3)}>Snooze 3 days</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => snooze(r, 7)}>Snooze 7 days</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              {canEdit && view === 'snoozed' && <Button size="xs" variant="outline" onClick={() => { useReminderStore.getState().unsnooze(r.id); toast.success('Reminder reactivated') }}>Unsnooze</Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function InspectionsPanel() {
  const inspections = useDb((s) => s.inspections)
  const vehicles = useDb((s) => s.vehicles)
  const { scope } = useBranchScope()
  const range = useDateRange()
  const data = useMemo(() => {
    const all = scope(inspections)
    const inR = all.filter((i) => range.inRange(i.date))
    const count = (r: string) => inR.filter((i) => i.result === r).length
    const recent = new Set(all.filter((i) => Date.now() - new Date(i.date).getTime() < 30 * 864e5).map((i) => i.vehicleId))
    const active = scope(vehicles).filter((v) => v.status !== 'out_of_service')
    return {
      total: inR.length, pass: count('pass'), cond: count('conditional'), fail: count('fail'),
      notInspected: active.filter((v) => !recent.has(v.id)).length, activeCount: active.length,
      attention: inR.filter((i) => i.result !== 'pass').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4),
    }
  }, [inspections, vehicles, scope, range])
  const rate = data.total ? (data.pass / data.total) * 100 : 100
  return (
    <Panel title="Vehicle inspections" description={`${data.total} in ${range.label.toLowerCase()}`} actions={<Button size="xs" variant="outline" asChild><Link to="/maintenance/inspections">Open <ClipboardCheck /></Link></Button>}>
      <div className="flex items-end justify-between">
        <div><div className="num text-2xl font-semibold leading-none">{Math.round(rate)}%</div><div className="mt-1 text-xs text-muted-foreground">pass rate</div></div>
        <div className="flex gap-3 text-center text-xs">
          <div><div className="num text-[15px] font-semibold text-success">{data.pass}</div>Pass</div>
          <div><div className="num text-[15px] font-semibold text-warning">{data.cond}</div>Conditional</div>
          <div><div className="num text-[15px] font-semibold text-danger">{data.fail}</div>Fail</div>
        </div>
      </div>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="bg-success" style={{ width: `${data.total ? (data.pass / data.total) * 100 : 0}%` }} />
        <div className="bg-warning" style={{ width: `${data.total ? (data.cond / data.total) * 100 : 0}%` }} />
        <div className="bg-danger" style={{ width: `${data.total ? (data.fail / data.total) * 100 : 0}%` }} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground"><span className={cn('num font-semibold', data.notInspected ? 'text-warning' : 'text-success')}>{data.notInspected}</span> of {data.activeCount} vehicles have no inspection in the last 30 days.</p>
      {data.attention.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
          {data.attention.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5"><VehicleLink id={i.vehicleId} /><span className="truncate text-muted-foreground">{i.defects[0] ?? i.type.replace('_', ' ')}</span></span>
              <Badge tone={i.result === 'fail' ? 'danger' : 'warning'}>{i.result === 'fail' ? 'Failed' : 'Conditional'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function CompliancePage() {
  const { rows, warnDays } = useDocRows()
  const vehicles = useDb((s) => s.vehicles)
  const { scope } = useBranchScope()
  const scopedVehicles = useMemo(() => scope(vehicles), [vehicles, scope])
  const summary = useMemo(() => summarise(rows, scopedVehicles), [rows, scopedVehicles])
  const canCreate = useCan('safety.create')
  const canEdit = useCan('safety.edit')
  const canDelete = useCan('safety.delete')
  const [group, setGroup] = useState('all')
  const [openId, setOpenId] = useOpenParam()
  const [params, setParams] = useSearchParams()
  const [addOpen, setAddOpen] = useState(false)
  const [renewing, setRenewing] = useState<DocRow | null>(null)

  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) setAddOpen(true)
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
  }, [params, setParams, canCreate])

  const g = DOC_GROUPS.find((x) => x.key === group) ?? DOC_GROUPS[0]!
  const shown = useMemo(() => (g.types ? rows.filter((r) => g.types!.includes(r.type)) : rows), [rows, g])
  const counts = useMemo(() => Object.fromEntries(DOC_GROUPS.map((x) => { const l = x.types ? rows.filter((r) => x.types!.includes(r.type)) : rows; return [x.key, { n: l.length, a: l.filter((r) => r.state === 'expired' || r.state === 'expiring').length }] })), [rows])

  const doc = openId ? rows.find((r) => r.id === openId) : undefined
  const dbDocs = useDb((s) => s.documents)
  useEffect(() => { if (openId && !doc && dbDocs.length && !dbDocs.some((d) => d.id === openId)) setOpenId(null) }, [openId, doc, dbDocs, setOpenId])

  const rowActions = (r: DocRow): RowAction[] => [
    { label: 'View details', icon: <FileText />, onClick: () => setOpenId(r.id) },
    { label: 'Renew', icon: <RefreshCw />, onClick: () => setRenewing(r), hidden: !canEdit },
    { label: 'Send reminder', icon: <Send />, onClick: () => sendReminders([r]), hidden: !canEdit || r.state === 'valid' },
    { label: 'Delete', icon: <Trash2 />, onClick: () => deleteDocs([r]), destructive: true, hidden: !canDelete, separatorBefore: true },
  ]
  const columns = useMemo<ColumnDef<DocRow, any>[]>(
    () => [
      { id: 'type', accessorFn: (r) => r.typeLabel, header: 'Document', size: 160, filterFn: 'inArray', cell: ({ row }) => <span className="font-medium">{row.original.typeLabel}</span> },
      { id: 'number', accessorFn: (r) => r.number, header: 'Number', size: 120, cell: ({ row }) => <span className="num text-muted-foreground">{row.original.number}</span> },
      { id: 'entity', accessorFn: (r) => r.entityName, header: 'Vehicle / driver', size: 160, cell: ({ row }) => (row.original.entityType === 'vehicle' ? <VehicleLink id={row.original.entityId} /> : <DriverLink id={row.original.entityId} />) },
      { id: 'kind', accessorFn: (r) => r.kind, header: 'Entity', size: 80, filterFn: 'inArray', meta: { hideBelow: 'lg' } },
      { id: 'issuer', accessorFn: (r) => r.issuer, header: 'Issuer', size: 170, meta: { hideBelow: 'xl' } },
      { id: 'issued', accessorFn: (r) => r.issueDate, header: 'Issued', size: 105, meta: { hideBelow: 'xl', exportValue: (r) => fmtDate(r.issueDate) }, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDate(row.original.issueDate)}</span> },
      { id: 'expiry', accessorFn: (r) => r.expiryDate, header: 'Expires', size: 105, meta: { exportValue: (r) => fmtDate(r.expiryDate) }, cell: ({ row }) => <span className="num">{fmtDate(row.original.expiryDate)}</span> },
      { id: 'state', accessorFn: (r) => r.stateLabel, header: 'Status', size: 130, filterFn: 'inArray', cell: ({ row }) => <ExpiryBadge iso={row.original.expiryDate} warnDays={warnDays} /> },
      { id: 'days', accessorFn: (r) => r.days, header: 'Days left', size: 90, meta: { align: 'right', hideBelow: 'md' }, cell: ({ row }) => <span className={cn('num', row.original.days < 0 && 'text-danger', row.original.days >= 0 && row.original.days <= warnDays && 'text-warning')}>{row.original.days}</span> },
      { id: 'branch', accessorFn: (r) => r.branchName, header: 'Branch', size: 130, filterFn: 'inArray', meta: { hideBelow: 'xl' } },
      { id: 'file', accessorFn: (r) => r.fileName, header: 'File', size: 190, meta: { hideBelow: 'xl' }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.fileName}</span> },
      actionsColumn<DocRow>(rowActions),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [warnDays, canEdit, canDelete, setOpenId],
  )

  const bulk: BulkAction<DocRow>[] = [
    ...(canEdit ? [{ label: 'Send reminders', icon: <Send />, onClick: (s: DocRow[], clear: () => void) => { const t = s.filter((r) => r.state !== 'valid'); if (!t.length) return toast.error('Selected documents are all valid — nothing to remind'); sendReminders(t); clear() } }] : []),
    ...(canDelete ? [{ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: (s: DocRow[], clear: () => void) => { void deleteDocs(s, clear) } }] : []),
  ]
  const facets = [
    { columnId: 'type', label: 'Type', options: Object.values(DOCUMENT_TYPE).map((v) => ({ value: v, label: v })) },
    { columnId: 'kind', label: 'Entity', options: [{ value: 'Vehicle', label: 'Vehicle' }, { value: 'Driver', label: 'Driver' }] },
    { columnId: 'state', label: 'Status', options: [{ value: 'Expired', label: 'Expired' }, { value: 'Expiring soon', label: `Expiring ≤ ${warnDays}d` }, { value: 'Valid', label: 'Valid' }] },
    { columnId: 'branch', label: 'Branch', options: [...new Set(rows.map((r) => r.branchName))].sort().map((v) => ({ value: v, label: v })) },
  ]
  const rate = Math.round(summary.rate)

  return (
    <Page>
      <PageHeader
        title="Compliance"
        description="Insurance, roadworthiness, licences, permits and driver certificates — one register with expiry tracking, renewals and reminders."
        actions={canCreate && <Button size="sm" onClick={() => setAddOpen(true)}><FilePlus2 /> Add document</Button>}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Compliance rate" icon={ShieldCheck} value={rate} format={(n) => `${Math.round(n)}%`} status={rate >= 95 ? 'success' : rate >= 85 ? 'warning' : 'danger'} hint="Share of documents that are not expired" />
        <KpiCard label="Expired" icon={FileWarning} value={summary.expired} status={summary.expired ? 'danger' : 'success'} onClick={() => { setGroup('all') }} />
        <KpiCard label={`Expiring ≤ ${warnDays}d`} icon={CalendarClock} value={summary.expiring} status={summary.expiring ? 'warning' : 'success'} />
        <KpiCard label="Non-compliant vehicles" icon={FileWarning} value={summary.nonCompliantVehicles.length} unit={`of ${scopedVehicles.length}`} status={summary.nonCompliantVehicles.length ? 'danger' : 'success'} hint="Any expired or missing core document" />
        <KpiCard label="Fully compliant" icon={ShieldCheck} value={summary.compliantVehiclePct} format={(n) => `${Math.round(n)}%`} unit="of vehicles" />
        <KpiCard label="Drivers with lapsed docs" icon={UserCheck} value={summary.driversLapsed} status={summary.driversLapsed ? 'danger' : 'success'} />
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <Tabs value={group} onValueChange={setGroup}>
            <TabsList variant="pills" className="max-w-full">
              {DOC_GROUPS.map((x) => (
                <TabsTrigger key={x.key} value={x.key}>
                  {x.label}
                  <span className="num text-xs text-muted-foreground">{counts[x.key]!.n}</span>
                  {counts[x.key]!.a > 0 && <Badge tone="warning" className="px-1">{counts[x.key]!.a}</Badge>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <DataTable<DocRow>
            data={shown} columns={columns} tableId="safety-compliance" getRowId={(r) => r.id} searchPlaceholder="Search document, number, vehicle, driver…" facets={facets} exportName="compliance-register"
            selectable bulkActions={bulk} defaultSort={[{ id: 'days', desc: false }]} defaultHidden={['file', 'branch']} onRowClick={(r) => setOpenId(r.id)}
            actions={canCreate && <Button size="sm" onClick={() => setAddOpen(true)}><FilePlus2 /> Add</Button>}
            emptyTitle="No documents" emptyDescription="No compliance documents match this tab or filter."
            rowClassName={(r) => (r.state === 'expired' ? 'bg-danger/[0.05]' : undefined)}
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{r.typeLabel}</span><ExpiryBadge iso={r.expiryDate} warnDays={warnDays} /></div>
                <p className="text-xs text-muted-foreground">{r.kind === 'Vehicle' ? <Plate>{r.entityName}</Plate> : r.entityName} · {r.number}</p>
                <p className="text-xs text-subtle-foreground">Expires {fmtDate(r.expiryDate)}</p>
              </div>
            )}
          />
        </div>
        <div className="space-y-3">
          <RemindersPanel rows={rows} onOpen={setOpenId} />
          <InspectionsPanel />
        </div>
      </div>

      <DocumentDrawer doc={doc} all={rows} onClose={() => setOpenId(null)} onRenew={(d) => setRenewing(d)} onSwitch={setOpenId} />
      <RenewDialog doc={renewing} onOpenChange={(o) => !o && setRenewing(null)} />
      <AddDocumentDialog open={addOpen} onOpenChange={setAddOpen} onCreated={setOpenId} />
    </Page>
  )
}

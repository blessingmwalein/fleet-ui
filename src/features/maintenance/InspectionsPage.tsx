import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { useWatch } from 'react-hook-form'
import { CheckCircle2, ClipboardCheck, ClipboardList, ClipboardPlus, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, XCircle } from 'lucide-react'
import { z } from 'zod'
import { toast } from 'sonner'
import type { Inspection } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { useDateRange } from '@/hooks/useFilters'
import { useById, useOpenParam } from '@/hooks/useLookup'
import { useVehicleOptions } from '@/hooks/useOptions'
import { FormDialog } from '@/components/forms/FormDialog'
import { CheckboxField, ComboField, DateField, FormGrid, FormSection, NumberField, SelectField, TextAreaField, TextField, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { DriverLink, EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { DataTable, actionsColumn, type FacetFilter } from '@/components/data-table/DataTable'
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { createInspection, currentUserName } from './lib/actions'
import { useInspectionRows, type InspectionRow } from './lib/data'
import { INSPECTION_ITEMS, INSPECTION_RESULT, INSPECTION_TYPE, deriveInspectionResult, inspectionMarker, linkedInspectionId, useOdometers } from './lib/maintenance'
import { useMaintenanceActions } from './components/MaintenanceActions'

const typeOptions = Object.entries(INSPECTION_TYPE).map(([value, label]) => ({ value, label }))
const resultOptions = Object.entries(INSPECTION_RESULT).map(([value, m]) => ({ value, label: m.label }))

const inspectionSchema = z
  .object({
    vehicleId: z.string().min(1, 'Select a vehicle'),
    type: z.enum(['pre_trip', 'post_trip', 'periodic', 'roadworthiness']),
    date: z.string().min(1, 'Enter the inspection time').refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60000, 'The inspection time cannot be in the future'),
    inspector: z.string().trim().min(2, 'Enter the inspector’s name').max(60, 'Max. 60 characters'),
    odometerKm: z.number({ error: 'Enter the odometer reading' }).min(0, 'Must be positive'),
    checklist: z.array(z.object({ item: z.string(), ok: z.boolean(), note: z.string().trim().max(120, 'Max. 120 characters').optional() })),
    extraDefects: z.string().trim().max(400, 'Max. 400 characters').optional(),
    resultOverride: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    v.checklist.forEach((c, i) => {
      if (!c.ok && !c.note) ctx.addIssue({ code: 'custom', path: ['checklist', i, 'note'], message: 'Describe the defect' })
    })
  })

function ChecklistFields({ form }: { form: AnyForm }) {
  const list = (useWatch({ control: form.control, name: 'checklist' }) ?? []) as { item: string; ok: boolean }[]
  const override = useWatch({ control: form.control, name: 'resultOverride' }) as string | undefined
  const auto = deriveInspectionResult(list)
  const result = (override || auto) as Inspection['result']
  const failed = list.filter((c) => !c.ok).length
  return (
    <FormSection title="Checklist" description={`${list.length - failed} of ${list.length} items OK`}>
      <div className="space-y-1.5">
        {list.map((c, i) => (
          <div key={c.item} className={cn('rounded-md border px-2.5 py-2', c.ok ? 'border-border' : 'border-danger/40 bg-danger/5')}>
            <CheckboxField form={form} name={`checklist.${i}.ok`} label={<span className={c.ok ? '' : 'font-medium text-danger'}>{c.item}{!c.ok && ' — defect'}</span>} />
            {!c.ok && <TextField form={form} name={`checklist.${i}.note`} placeholder="Describe the defect (e.g. leak observed)" className="mt-2" />}
          </div>
        ))}
      </div>
      <TextAreaField form={form} name="extraDefects" label="Other defects (one per line)" rows={2} placeholder="Anything not covered by the checklist…" />
      <FormGrid>
        <SelectField form={form} name="resultOverride" label="Result" options={resultOptions} allowEmpty emptyLabel="Auto — from checklist" placeholder="Auto — from checklist" hint="Failures on brakes, tyres or steering fail the inspection." />
        <div className="flex items-end pb-1"><Badge tone={INSPECTION_RESULT[result].tone} className="px-2 py-1 text-xs">Outcome: {INSPECTION_RESULT[result].label}</Badge></div>
      </FormGrid>
    </FormSection>
  )
}

function InspectionFormDialog({ open, onOpenChange, onRaise }: { open: boolean; onOpenChange: (o: boolean) => void; onRaise: (ins: Inspection) => void }) {
  const options = useVehicleOptions()
  const odometers = useOdometers()
  const getVehicle = useById('vehicles')
  const defaults = useMemo(
    () => ({ vehicleId: '', type: 'periodic' as const, date: toInputDateTime(new Date().toISOString()), inspector: currentUserName(), odometerKm: undefined as unknown as number, checklist: INSPECTION_ITEMS.map((item) => ({ item, ok: true, note: '' })), extraDefects: '', resultOverride: '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      size="lg"
      title="New inspection"
      description="Record a vehicle inspection. Failed items become defects and can be raised as a work order."
      schema={inspectionSchema}
      defaultValues={defaults}
      submitLabel="Record inspection"
      onSubmit={(v) => {
        const veh = getVehicle(v.vehicleId)
        if (!veh) throw new Error('Vehicle not found')
        const checklist = v.checklist.map((c) => ({ item: c.item, ok: c.ok, note: c.ok ? undefined : c.note }))
        const extra = (v.extraDefects ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
        const defects = [...checklist.filter((c) => !c.ok).map((c) => `${c.item}: ${c.note}`), ...extra]
        const auto = deriveInspectionResult(checklist)
        const result = (v.resultOverride || (extra.length && auto === 'pass' ? 'conditional' : auto)) as Inspection['result']
        const ins = createInspection({ vehicleId: veh.id, driverId: veh.driverId, branchId: veh.branchId, date: new Date(v.date).toISOString(), type: v.type, result, odometerKm: v.odometerKm, checklist, defects, inspector: v.inspector })
        if (defects.length) setTimeout(() => onRaise(ins), 150)
      }}
    >
      {(form) => (
        <>
          <ComboField form={form} name="vehicleId" label="Vehicle" required options={options} placeholder="Select vehicle…" searchPlaceholder="Search registration or model…" />
          <VehicleOdoHint form={form} odometers={odometers} />
          <FormGrid>
            <SelectField form={form} name="type" label="Inspection type" required options={typeOptions} />
            <DateField form={form} name="date" label="Inspected on" withTime required />
            <TextField form={form} name="inspector" label="Inspector" required />
            <NumberField form={form} name="odometerKm" label="Odometer" required suffix="km" min={0} />
          </FormGrid>
          <ChecklistFields form={form} />
        </>
      )}
    </FormDialog>
  )
}

/** Prefills the odometer when a vehicle is picked and shows the last known reading. */
function VehicleOdoHint({ form, odometers }: { form: AnyForm; odometers: Map<string, number> }) {
  const vehicleId = useWatch({ control: form.control, name: 'vehicleId' }) as string
  useEffect(() => {
    const odo = odometers.get(vehicleId)
    if (vehicleId && odo !== undefined && !form.getFieldState('odometerKm').isDirty) form.setValue('odometerKm', Math.round(odo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId])
  return null
}

export default function InspectionsPage() {
  const rows = useInspectionRows()
  const branches = useDb((s) => s.branches)
  const workOrders = useDb((s) => s.workOrders)
  const range = useDateRange()
  const canCreate = useCan('maintenance.create')
  const canDelete = useCan('maintenance.delete')
  const [openId, setOpenId] = useOpenParam()
  const [params, setParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const { request, host } = useMaintenanceActions()

  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) setFormOpen(true)
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const raiseWo = (ins: Inspection) => {
    const defects = ins.defects
    request({
      vehicleId: ins.vehicleId, type: ins.type === 'roadworthiness' ? 'inspection' : 'corrective', priority: ins.result === 'fail' ? 'high' : 'medium', title: `Defects from ${ins.ref}`,
      description: `Defects found during the ${INSPECTION_TYPE[ins.type].toLowerCase()} inspection ${ins.ref}:\n${defects.map((d) => `• ${d}`).join('\n')}`, notes: `Raised from inspection ${ins.ref} ${inspectionMarker(ins.id)}`, scheduleNow: true,
    })
  }
  const offerWo = async (ins: Inspection) => {
    if (await confirm({ title: `Raise a work order for ${ins.defects.length} defect${ins.defects.length > 1 ? 's' : ''}?`, description: `${ins.ref} ${ins.result === 'fail' ? 'failed' : 'passed conditionally'}. Create a corrective work order so the defects are repaired.`, confirmLabel: 'Raise work order', cancelLabel: 'Not now' })) raiseWo(ins)
  }

  const stats = useMemo(() => {
    const inR = rows.filter((r) => range.inRange(r.date))
    const prev = rows.filter((r) => range.inPrevRange(r.date))
    const rate = (l: InspectionRow[]) => (l.length ? (l.filter((r) => r.result === 'pass').length / l.length) * 100 : 0)
    const latest = new Map<string, InspectionRow>()
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) latest.set(r.vehicleId, r)
    return {
      total: inR.length, prevTotal: prev.length, rate: rate(inR), prevRate: rate(prev),
      conditional: inR.filter((r) => r.result === 'conditional').length, fail: inR.filter((r) => r.result === 'fail').length,
      attention: [...latest.values()].filter((r) => r.result !== 'pass').length,
    }
  }, [rows, range])

  const woByInspection = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of workOrders) { const id = linkedInspectionId(w.notes); if (id) m.set(id, w.id) }
    return m
  }, [workOrders])

  const facets = useMemo<FacetFilter[]>(
    () => [
      { columnId: 'result', label: 'Result', options: resultOptions },
      { columnId: 'type', label: 'Type', options: typeOptions },
      { columnId: 'branchName', label: 'Branch', options: branches.map((b) => ({ value: b.name, label: b.name })) },
    ],
    [branches],
  )

  const columns = useMemo<ColumnDef<InspectionRow, any>[]>(
    () => [
      { accessorKey: 'ref', header: 'Reference', size: 100, cell: ({ row }) => <button type="button" className="num font-medium text-primary hover:underline" onClick={() => setOpenId(row.original.id)}>{row.original.ref}</button> },
      { accessorKey: 'date', header: 'Date', size: 130, meta: { exportValue: (r) => fmtDateTime(r.date) }, cell: ({ row }) => fmtDate(row.original.date, 'dd MMM yyyy, HH:mm') },
      { accessorKey: 'reg', header: 'Vehicle', size: 140, cell: ({ row }) => <div className="leading-tight"><VehicleLink id={row.original.vehicleId} /><div className="truncate text-xs text-muted-foreground">{row.original.vehicleName}</div></div> },
      { accessorKey: 'type', header: 'Type', size: 110, meta: { exportValue: (r) => INSPECTION_TYPE[r.type] }, cell: ({ row }) => INSPECTION_TYPE[row.original.type] },
      { accessorKey: 'result', header: 'Result', size: 110, meta: { exportValue: (r) => INSPECTION_RESULT[r.result].label }, cell: ({ row }) => <Badge tone={INSPECTION_RESULT[row.original.result].tone}>{INSPECTION_RESULT[row.original.result].label}</Badge> },
      { accessorKey: 'defectCount', header: 'Defects', size: 280, meta: { exportValue: (r) => r.defects.join('; ') }, cell: ({ row }) => (row.original.defectCount ? <span className="flex items-center gap-2"><Badge tone="danger">{row.original.defectCount}</Badge><span className="truncate text-xs text-muted-foreground">{row.original.defects[0]}</span></span> : <span className="text-subtle-foreground">None</span>) },
      { accessorKey: 'inspector', header: 'Inspector', size: 140 },
      { accessorKey: 'driverName', header: 'Driver', size: 140, cell: ({ row }) => <DriverLink id={row.original.driverId} /> },
      { accessorKey: 'odometerKm', header: 'Odometer', size: 100, meta: { align: 'right' }, cell: ({ row }) => `${fmtNumber(row.original.odometerKm)} km` },
      { accessorKey: 'branchName', header: 'Branch', size: 150 },
      actionsColumn<InspectionRow>((r) => [
        { label: 'View checklist', icon: <ClipboardList />, onClick: () => setOpenId(r.id) },
        { label: 'Raise work order', icon: <ClipboardPlus />, onClick: () => raiseWo(r), hidden: !canCreate || !r.defectCount || woByInspection.has(r.id) },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canCreate, woByInspection],
  )

  const selected = rows.find((r) => r.id === openId)
  const linkedWo = selected ? woByInspection.get(selected.id) : undefined

  return (
    <Page>
      <PageHeader title="Inspections" description="Pre-trip, post-trip, periodic and roadworthiness inspections with defect tracking." actions={canCreate && <Button onClick={() => setFormOpen(true)}><ClipboardPlus /> New inspection</Button>} />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Inspections" value={stats.total} icon={ClipboardCheck} delta={{ pct: stats.prevTotal ? ((stats.total - stats.prevTotal) / stats.prevTotal) * 100 : 0 }} hint={`Completed in ${range.label.toLowerCase()}`} />
        <KpiCard label="Pass rate" value={stats.rate} format={(n) => `${n.toFixed(0)}%`} icon={ShieldCheck} status={stats.rate >= 80 ? 'success' : 'warning'} delta={{ pct: stats.rate - stats.prevRate, label: 'pts vs prev.' }} />
        <KpiCard label="Conditional" value={stats.conditional} icon={TriangleAlert} status="warning" />
        <KpiCard label="Failed" value={stats.fail} icon={XCircle} status={stats.fail ? 'danger' : 'success'} />
        <KpiCard label="Vehicles needing action" value={stats.attention} icon={ShieldAlert} status={stats.attention ? 'danger' : 'success'} hint="Vehicles whose latest inspection was not a clean pass" />
      </div>

      <DataTable
        tableId="maintenance-inspections"
        exportName="inspections"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        facets={facets}
        searchPlaceholder="Search inspections, vehicles, defects…"
        selectable={canDelete}
        bulkActions={[{
          label: 'Delete', icon: <Trash2 />, destructive: true,
          onClick: async (sel, clear) => {
            if (await confirm({ title: `Delete ${sel.length} inspection${sel.length > 1 ? 's' : ''}?`, description: 'The inspection records are permanently removed.', confirmLabel: 'Delete', destructive: true })) {
              useDb.getState().removeMany('inspections', sel.map((s) => s.id))
              toast.success(`${sel.length} inspection${sel.length > 1 ? 's' : ''} deleted`)
              clear()
            }
          },
        }]}
        defaultHidden={['driverName', 'odometerKm', 'branchName']}
        defaultSort={[{ id: 'date', desc: true }]}
        onRowClick={(r) => setOpenId(r.id)}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><span className="num font-medium text-primary">{r.ref}</span><Badge tone={INSPECTION_RESULT[r.result].tone}>{INSPECTION_RESULT[r.result].label}</Badge></div>
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"><VehicleLink id={r.vehicleId} /><span>{INSPECTION_TYPE[r.type]}</span><span>{fmtDate(r.date, 'dd MMM, HH:mm')}</span></div>
            {r.defectCount > 0 && <p className="text-xs text-danger">{r.defectCount} defect{r.defectCount > 1 ? 's' : ''}: {r.defects[0]}</p>}
          </div>
        )}
      />

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent size="lg">
          {!selected ? (
            <>
              <SheetHeader><SheetTitle>Inspection</SheetTitle><SheetDescription>Details</SheetDescription></SheetHeader>
              <EmptyState icon={ClipboardList} title="Inspection not found" description="It may have been deleted, or is outside the current branch scope." />
            </>
          ) : (
            <>
              <SheetHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6"><SheetTitle className="num">{selected.ref}</SheetTitle><Badge tone={INSPECTION_RESULT[selected.result].tone}>{INSPECTION_RESULT[selected.result].label}</Badge></div>
                <SheetDescription>{INSPECTION_TYPE[selected.type]} inspection · {fmtDateTime(selected.date)}</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <DetailGrid
                  items={[
                    { label: 'Vehicle', value: <span className="inline-flex items-center gap-1.5"><VehicleLink id={selected.vehicleId} /><span className="text-xs text-muted-foreground">{selected.vehicleName}</span></span> },
                    { label: 'Driver', value: <DriverLink id={selected.driverId} /> },
                    { label: 'Inspector', value: selected.inspector },
                    { label: 'Odometer', value: `${fmtNumber(selected.odometerKm)} km` },
                    { label: 'Branch', value: <EntityLink type="branch" id={selected.branchId}>{selected.branchName}</EntityLink> },
                    { label: 'Linked work order', value: linkedWo ? <EntityLink type="workorder" id={linkedWo} /> : 'None' },
                  ]}
                />
                <Panel title="Checklist" description={`${selected.checklist.filter((c) => c.ok).length} of ${selected.checklist.length} items OK`} flush>
                  <ul className="divide-y divide-border/70">
                    {selected.checklist.map((c) => (
                      <li key={c.item} className="flex items-start gap-2.5 px-3.5 py-2 text-[13px]">
                        {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                        <div className="min-w-0"><p className={c.ok ? '' : 'font-medium'}>{c.item}</p>{c.note && <p className="text-xs text-danger">{c.note}</p>}</div>
                      </li>
                    ))}
                  </ul>
                </Panel>
                {selected.defects.length > 0 && (
                  <Panel title="Defects raised" description={`${selected.defects.length} to resolve`}>
                    <ul className="list-disc space-y-1 pl-4 text-[13px]">{selected.defects.map((d) => <li key={d}>{d}</li>)}</ul>
                  </Panel>
                )}
              </SheetBody>
              <SheetFooter>
                {canDelete && <Button variant="outline" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: `Delete ${selected.ref}?`, confirmLabel: 'Delete', destructive: true })) { useDb.getState().remove('inspections', selected.id); toast.success(`${selected.ref} deleted`); setOpenId(null) } }}><Trash2 /> Delete</Button>}
                {canCreate && selected.defects.length > 0 && !linkedWo && <Button onClick={() => raiseWo(selected)}><ClipboardPlus /> Raise work order</Button>}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <InspectionFormDialog open={formOpen} onOpenChange={setFormOpen} onRaise={offerWo} />
      {host}
    </Page>
  )
}

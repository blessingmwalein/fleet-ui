import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Download, FilePlus2, FileText, RefreshCw, ShieldAlert, Trash2, Eye } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { DocumentRecord, Expense, Incident, SafetyEvent, Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { KpiCard } from '@/components/shared/KpiCard'
import { Panel, DetailGrid } from '@/components/shared/Page'
import { ExpiryBadge, Status } from '@/components/shared/Status'
import { DriverLink, EntityLink, TripLink } from '@/components/shared/EntityLink'
import { BarList, ChartCard, DonutChart, chartColor } from '@/components/charts/charts'
import { DataTable, actionsColumn } from '@/components/data-table/DataTable'
import { DOCUMENT_TYPE, EXPENSE_CATEGORY, EXPENSE_STATUS, INCIDENT_SEVERITY, INCIDENT_STATUS, INCIDENT_TYPE, SAFETY_EVENT_TYPE, expiryState } from '@/config/status'
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fmtBytesKb } from './lib'
import type { VehicleKpis } from './useVehicleKpis'
import type { ShowVehicleDialog } from './VehicleDialogs'
import { useVehicleDocuments, useVehicleExpenses, useVehicleIncidents, useVehicleSafetyEvents } from './useVehicleData'

interface TabProps {
  vehicle: Vehicle
  kpis: VehicleKpis
  show: ShowVehicleDialog
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */
interface ExpenseRow extends Expense {
  driverName: string
  tripRef: string
}

export function ExpensesTab({ vehicle: v }: TabProps) {
  const money = useMoney()
  const expenses = useVehicleExpenses(v.id)
  const drivers = useDb((s) => s.drivers)
  const trips = useDb((s) => s.trips)

  const rows = useMemo<ExpenseRow[]>(() => {
    const d = new Map(drivers.map((x) => [x.id, x.name]))
    const t = new Map(trips.map((x) => [x.id, x.ref]))
    return expenses.map((e) => ({ ...e, driverName: e.driverId ? (d.get(e.driverId) ?? '') : '', tripRef: e.tripId ? (t.get(e.tripId) ?? '') : '' }))
  }, [expenses, drivers, trips])

  const stats = useMemo(() => {
    const sum = (f: (e: Expense) => boolean) => expenses.filter(f).reduce((s, e) => s + e.amountUsd, 0)
    const byCat = new Map<string, number>()
    for (const e of expenses) if (e.status !== 'rejected') byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountUsd)
    const cutoff = Date.now() - 90 * 864e5
    return {
      total: sum((e) => e.status !== 'rejected'),
      last90: sum((e) => e.status !== 'rejected' && new Date(e.date).getTime() >= cutoff),
      pending: sum((e) => e.status === 'pending'),
      pendingCount: expenses.filter((e) => e.status === 'pending').length,
      paid: sum((e) => e.status === 'paid'),
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [expenses])

  const columns = useMemo<ColumnDef<ExpenseRow, any>[]>(
    () => [
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Expense', size: 115, cell: ({ row }) => <EntityLink type="expense" id={row.original.id} />, meta: { label: 'Expense' } },
      { id: 'date', accessorFn: (r) => r.date, header: 'Date', size: 105, cell: ({ row }) => <span className="num">{fmtDate(row.original.date)}</span>, meta: { label: 'Date' } },
      { id: 'category', accessorFn: (r) => r.category, header: 'Category', size: 140, filterFn: 'inArray', cell: ({ row }) => EXPENSE_CATEGORY[row.original.category], meta: { label: 'Category', exportValue: (r) => EXPENSE_CATEGORY[r.category] } },
      { id: 'description', accessorFn: (r) => r.description, header: 'Description', size: 240, meta: { label: 'Description' } },
      { id: 'trip', accessorFn: (r) => r.tripRef, header: 'Trip', size: 130, cell: ({ row }) => <TripLink id={row.original.tripId} />, meta: { label: 'Trip' } },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} avatar />, meta: { label: 'Driver' } },
      { id: 'supplier', accessorFn: (r) => r.supplier, header: 'Supplier', size: 150, meta: { label: 'Supplier' } },
      { id: 'amount', accessorFn: (r) => r.amountUsd, header: 'Amount', size: 95, enableGlobalFilter: false, meta: { align: 'right', label: 'Amount (USD)' }, cell: ({ row }) => money(row.original.amountUsd, { digits: 2 }) },
      { id: 'status', accessorFn: (r) => r.status, header: 'Status', size: 105, filterFn: 'inArray', cell: ({ row }) => <Status kind="expense" value={row.original.status} />, meta: { label: 'Status', exportValue: (r) => EXPENSE_STATUS[r.status]!.label } },
    ],
    [money],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total expenses" value={money(stats.total)} hint="Excludes rejected claims" />
        <KpiCard label="Last 90 days" value={money(stats.last90)} />
        <KpiCard label="Pending approval" value={money(stats.pending)} status={stats.pendingCount ? 'warning' : 'success'} hint={`${stats.pendingCount} claim${stats.pendingCount === 1 ? '' : 's'} awaiting approval`} />
        <KpiCard label="Paid" value={money(stats.paid)} status="success" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Expenses by category" description="Approved, pending and paid claims" className="lg:col-span-1">
          {stats.byCat.length ? (
            <DonutChart height={150} data={stats.byCat.map(([k, val], i) => ({ name: EXPENSE_CATEGORY[k as keyof typeof EXPENSE_CATEGORY], value: Math.round(val), color: chartColor(i) }))} format={(n) => money(n)} centerLabel="Total" centerValue={money(stats.total, { compact: true })} />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No expenses recorded</p>
          )}
        </ChartCard>
        <div className="lg:col-span-2">
          <DataTable<ExpenseRow>
            tableId="vehicle-expenses"
            exportName={`${v.reg.replace(' ', '')}-expenses`}
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            defaultSort={[{ id: 'date', desc: true }]}
            defaultPageSize={10}
            pageSizes={[10, 25, 50]}
            searchPlaceholder="Search expenses…"
            facets={[
              { columnId: 'status', label: 'Status', options: Object.entries(EXPENSE_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { columnId: 'category', label: 'Category', options: Object.entries(EXPENSE_CATEGORY).map(([value, label]) => ({ value, label })) },
            ]}
            emptyTitle="No expenses for this vehicle"
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between"><EntityLink type="expense" id={r.id} /><Status kind="expense" value={r.status} /></div>
                <div className="text-[13px]">{r.description}</div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>{EXPENSE_CATEGORY[r.category]} · {fmtDate(r.date)}</span><span>{money(r.amountUsd, { digits: 2 })}</span></div>
              </div>
            )}
          />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */
interface DocRow extends DocumentRecord {
  typeLabel: string
  stateKey: 'expired' | 'expiring' | 'valid'
  days: number
}

export function DocumentsTab({ vehicle: v, kpis, show }: TabProps) {
  const canEdit = useCan('vehicles.edit')
  const docs = useVehicleDocuments(v.id)
  const [viewDoc, setViewDoc] = useState<DocumentRecord | null>(null)

  const rows = useMemo<DocRow[]>(() => {
    return docs.map((d) => {
      const e = expiryState(d.expiryDate)
      return { ...d, typeLabel: DOCUMENT_TYPE[d.type], stateKey: e.state === 'unknown' ? 'valid' : e.state, days: e.days }
    })
  }, [docs])

  const remove = async (d: DocumentRecord) => {
    if (!(await confirm({ title: `Delete ${DOCUMENT_TYPE[d.type]}?`, description: `${d.number} (${d.fileName}) will be permanently removed from ${v.reg}.`, destructive: true, confirmLabel: 'Delete document' }))) return
    useDb.getState().remove('documents', d.id, { summary: `Deleted ${DOCUMENT_TYPE[d.type]} ${d.number} from ${v.reg}` })
    toast.success('Document deleted')
  }

  const columns = useMemo<ColumnDef<DocRow, any>[]>(
    () => [
      { id: 'type', accessorFn: (r) => r.typeLabel, header: 'Document', size: 170, filterFn: 'inArray', meta: { label: 'Document' }, cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5 text-muted-foreground" />{row.original.typeLabel}</span> },
      { id: 'number', accessorFn: (r) => r.number, header: 'Number', size: 130, meta: { label: 'Number' }, cell: ({ row }) => <EntityLink type="document" id={row.original.id} /> },
      { id: 'issuer', accessorFn: (r) => r.issuer, header: 'Issuer', size: 170, meta: { label: 'Issuer' } },
      { id: 'issued', accessorFn: (r) => r.issueDate, header: 'Issued', size: 105, enableGlobalFilter: false, cell: ({ row }) => <span className="num">{fmtDate(row.original.issueDate)}</span>, meta: { label: 'Issued' } },
      { id: 'expiry', accessorFn: (r) => r.expiryDate, header: 'Expires', size: 175, enableGlobalFilter: false, meta: { label: 'Expires' }, cell: ({ row }) => <span className="inline-flex items-center gap-2"><span className="num">{fmtDate(row.original.expiryDate)}</span><ExpiryBadge iso={row.original.expiryDate} /></span> },
      { id: 'state', accessorFn: (r) => r.stateKey, header: 'State', size: 90, filterFn: 'inArray', meta: { label: 'State' }, cell: ({ row }) => <span className="capitalize">{row.original.stateKey}</span> },
      { id: 'file', accessorFn: (r) => r.fileName, header: 'File', size: 200, meta: { label: 'File', exportValue: (r) => `${r.fileName} (${fmtBytesKb(r.fileSizeKb)})` }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.fileName} <span className="text-subtle-foreground">· {fmtBytesKb(row.original.fileSizeKb)}</span></span> },
      { id: 'uploaded', accessorFn: (r) => r.uploadedBy, header: 'Uploaded by', size: 140, meta: { label: 'Uploaded by' }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.uploadedBy}<span className="block text-[11px] text-subtle-foreground">{fmtDate(row.original.uploadedAt)}</span></span> },
      actionsColumn<DocRow>((d) => [
        { label: 'View details', icon: <Eye />, onClick: () => setViewDoc(d) },
        { label: 'Download file', icon: <Download />, onClick: () => downloadPlaceholder(d) },
        { label: 'Renew', icon: <RefreshCw />, hidden: !canEdit, onClick: () => show({ kind: 'document', vehicle: v, doc: d }) },
        { label: 'Delete', icon: <Trash2 />, destructive: true, hidden: !canEdit, separatorBefore: true, onClick: () => void remove(d) },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, show, v],
  )

  return (
    <div className="space-y-4">
      <Panel
        title="Compliance checklist"
        description={`${kpis.compliance.valid} of ${kpis.compliance.total} required documents valid`}
        actions={canEdit ? <Button size="sm" onClick={() => show({ kind: 'document', vehicle: v })}><FilePlus2 /> Upload document</Button> : undefined}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.compliance.items.map((c) => (
            <div key={c.type} className={cn('rounded-md border p-3', c.state === 'valid' ? 'border-border' : c.state === 'expiring' ? 'border-warning/40 bg-warning/5' : 'border-danger/40 bg-danger/5')}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium">{c.label}</span>
                {c.doc ? <ExpiryBadge iso={c.doc.expiryDate} /> : <Badge tone="danger">Missing</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{c.doc ? `${c.doc.number} · expires ${fmtDate(c.doc.expiryDate)}` : 'No document on file'}</div>
              {canEdit && c.state !== 'valid' && (
                <Button size="xs" variant="outline" className="mt-2" onClick={() => (c.doc ? show({ kind: 'document', vehicle: v, doc: c.doc }) : show({ kind: 'document', vehicle: v, type: c.type }))}>
                  {c.doc ? <><RefreshCw /> Renew</> : <><FilePlus2 /> Upload</>}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <DataTable<DocRow>
        tableId="vehicle-documents"
        exportName={`${v.reg.replace(' ', '')}-documents`}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        defaultSort={[{ id: 'expiry', desc: false }]}
        defaultPageSize={10}
        searchPlaceholder="Search documents…"
        facets={[
          { columnId: 'state', label: 'State', options: [{ value: 'expired', label: 'Expired' }, { value: 'expiring', label: 'Expiring ≤30d' }, { value: 'valid', label: 'Valid' }] },
          { columnId: 'type', label: 'Type', options: [...new Set(rows.map((r) => r.typeLabel))].map((t) => ({ value: t, label: t })) },
        ]}
        emptyTitle="No documents on file"
        emptyDescription="Upload insurance, roadworthiness and licence documents to track expiry."
        onRowClick={(d) => setViewDoc(d)}
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between"><span className="font-medium">{r.typeLabel}</span><ExpiryBadge iso={r.expiryDate} /></div>
            <div className="text-xs text-muted-foreground">{r.number} · expires {fmtDate(r.expiryDate)}</div>
          </div>
        )}
      />

      <Dialog open={!!viewDoc} onOpenChange={(o) => !o && setViewDoc(null)}>
        <DialogContent size="md">
          {viewDoc && (
            <>
              <DialogHeader>
                <DialogTitle>{DOCUMENT_TYPE[viewDoc.type]}</DialogTitle>
                <DialogDescription>{viewDoc.number} · {v.reg}</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-2/50 text-muted-foreground">
                  <div className="text-center"><FileText className="mx-auto mb-1 size-8" /><div className="text-xs">{viewDoc.fileName}</div><div className="text-[11px] text-subtle-foreground">Preview unavailable in demo · {fmtBytesKb(viewDoc.fileSizeKb)}</div></div>
                </div>
                <DetailGrid
                  items={[
                    { label: 'Issuer', value: viewDoc.issuer },
                    { label: 'Number', value: viewDoc.number },
                    { label: 'Issued', value: fmtDate(viewDoc.issueDate) },
                    { label: 'Expires', value: <span className="inline-flex items-center gap-2">{fmtDate(viewDoc.expiryDate)} <ExpiryBadge iso={viewDoc.expiryDate} /></span> },
                    { label: 'Uploaded by', value: viewDoc.uploadedBy },
                    { label: 'Uploaded', value: fmtDateTime(viewDoc.uploadedAt) },
                  ]}
                />
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => downloadPlaceholder(viewDoc)}><Download /> Download</Button>
                {canEdit && <Button onClick={() => { const d = viewDoc; setViewDoc(null); show({ kind: 'document', vehicle: v, doc: d }) }}><RefreshCw /> Renew</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Demo download: generates a small text stub for the document record. */
function downloadPlaceholder(d: DocumentRecord) {
  const text = `FleetCore demo document\r\nType: ${DOCUMENT_TYPE[d.type]}\r\nNumber: ${d.number}\r\nIssuer: ${d.issuer}\r\nIssued: ${fmtDate(d.issueDate)}\r\nExpires: ${fmtDate(d.expiryDate)}\r\nOriginal file: ${d.fileName}\r\n`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = d.fileName.replace(/\.[a-z0-9]+$/i, '') + '-details.txt'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast.success('Document details downloaded')
}

/* ------------------------------------------------------------------ */
/* Incidents & safety                                                  */
/* ------------------------------------------------------------------ */
interface IncidentRow extends Incident {
  driverName: string
}
interface EventRow extends SafetyEvent {
  driverName: string
}

export function IncidentsTab({ vehicle: v }: TabProps) {
  const money = useMoney()
  const canReport = useCan('safety.create')
  const incidents = useVehicleIncidents(v.id)
  const events = useVehicleSafetyEvents(v.id)
  const drivers = useDb((s) => s.drivers)

  const dName = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers])
  const incRows = useMemo<IncidentRow[]>(() => incidents.map((i) => ({ ...i, driverName: i.driverId ? (dName.get(i.driverId) ?? '') : '' })), [incidents, dName])
  const evRows = useMemo<EventRow[]>(() => events.map((e) => ({ ...e, driverName: e.driverId ? (dName.get(e.driverId) ?? '') : '' })), [events, dName])

  const stats = useMemo(() => {
    const cutoff = Date.now() - 90 * 864e5
    const byType = new Map<string, number>()
    for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
    return {
      cost: incidents.reduce((s, i) => s + i.estCostUsd, 0),
      open: incidents.filter((i) => i.status === 'reported' || i.status === 'investigating').length,
      ev90: events.filter((e) => new Date(e.timestamp).getTime() >= cutoff).length,
      high: events.filter((e) => e.severity === 'high').length,
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [incidents, events])

  const incColumns = useMemo<ColumnDef<IncidentRow, any>[]>(
    () => [
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Incident', size: 120, cell: ({ row }) => <EntityLink type="incident" id={row.original.id} />, meta: { label: 'Incident' } },
      { id: 'date', accessorFn: (r) => r.date, header: 'Date', size: 150, cell: ({ row }) => <span className="num">{fmtDateTime(row.original.date)}</span>, meta: { label: 'Date' } },
      { id: 'type', accessorFn: (r) => r.type, header: 'Type', size: 120, filterFn: 'inArray', cell: ({ row }) => INCIDENT_TYPE[row.original.type], meta: { label: 'Type', exportValue: (r) => INCIDENT_TYPE[r.type] } },
      { id: 'severity', accessorFn: (r) => r.severity, header: 'Severity', size: 100, filterFn: 'inArray', cell: ({ row }) => <Badge tone={INCIDENT_SEVERITY[row.original.severity]!.tone}>{INCIDENT_SEVERITY[row.original.severity]!.label}</Badge>, meta: { label: 'Severity' } },
      { id: 'status', accessorFn: (r) => r.status, header: 'Status', size: 120, filterFn: 'inArray', cell: ({ row }) => <Status kind="incident" value={row.original.status} />, meta: { label: 'Status', exportValue: (r) => INCIDENT_STATUS[r.status]!.label } },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} avatar />, meta: { label: 'Driver' } },
      { id: 'location', accessorFn: (r) => r.location, header: 'Location', size: 220, meta: { label: 'Location' } },
      { id: 'injuries', accessorFn: (r) => r.injuries, header: 'Injuries', size: 80, enableGlobalFilter: false, meta: { align: 'right', label: 'Injuries' } },
      { id: 'cost', accessorFn: (r) => r.estCostUsd, header: 'Est. cost', size: 95, enableGlobalFilter: false, meta: { align: 'right', label: 'Est. cost (USD)' }, cell: ({ row }) => money(row.original.estCostUsd) },
    ],
    [money],
  )

  const evColumns = useMemo<ColumnDef<EventRow, any>[]>(
    () => [
      { id: 'time', accessorFn: (r) => r.timestamp, header: 'Time', size: 150, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.timestamp)}</span>, meta: { label: 'Time' } },
      { id: 'type', accessorFn: (r) => r.type, header: 'Event', size: 150, filterFn: 'inArray', cell: ({ row }) => SAFETY_EVENT_TYPE[row.original.type], meta: { label: 'Event', exportValue: (r) => SAFETY_EVENT_TYPE[r.type] } },
      { id: 'severity', accessorFn: (r) => r.severity, header: 'Severity', size: 90, filterFn: 'inArray', cell: ({ row }) => <Badge tone={row.original.severity === 'high' ? 'danger' : row.original.severity === 'medium' ? 'warning' : 'neutral'} className="capitalize">{row.original.severity}</Badge>, meta: { label: 'Severity' } },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} avatar />, meta: { label: 'Driver' } },
      { id: 'location', accessorFn: (r) => r.location, header: 'Location', size: 230, meta: { label: 'Location' } },
      { id: 'speed', accessorFn: (r) => r.speedKph, header: 'Speed', size: 110, enableGlobalFilter: false, meta: { align: 'right', label: 'Speed (km/h)' }, cell: ({ row }) => (row.original.limitKph ? `${Math.round(row.original.speedKph)} / ${row.original.limitKph}` : `${Math.round(row.original.speedKph)}`) },
      { id: 'reviewed', accessorFn: (r) => (r.reviewed ? 'Reviewed' : 'Open'), header: 'Review', size: 90, meta: { label: 'Review' }, cell: ({ row }) => <Badge tone={row.original.reviewed ? 'success' : 'warning'}>{row.original.reviewed ? 'Reviewed' : 'Open'}</Badge> },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Incidents" value={incidents.length} icon={ShieldAlert} status={stats.open ? 'warning' : 'success'} hint={`${stats.open} open`} />
        <KpiCard label="Estimated cost" value={money(stats.cost, { compact: true })} />
        <KpiCard label="Safety events (90d)" value={stats.ev90} />
        <KpiCard label="High-severity events" value={stats.high} status={stats.high ? 'danger' : 'success'} />
        <KpiCard label="Open incidents" value={stats.open} status={stats.open ? 'warning' : 'success'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DataTable<IncidentRow>
            tableId="vehicle-incidents"
            exportName={`${v.reg.replace(' ', '')}-incidents`}
            data={incRows}
            columns={incColumns}
            getRowId={(r) => r.id}
            defaultSort={[{ id: 'date', desc: true }]}
            defaultPageSize={5}
            pageSizes={[5, 10, 25]}
            searchPlaceholder="Search incidents…"
            facets={[
              { columnId: 'severity', label: 'Severity', options: Object.entries(INCIDENT_SEVERITY).map(([value, m]) => ({ value, label: m.label })) },
              { columnId: 'status', label: 'Status', options: Object.entries(INCIDENT_STATUS).map(([value, m]) => ({ value, label: m.label })) },
            ]}
            actions={canReport ? <Button asChild size="sm" variant="outline"><Link to="/safety/incidents?new=1"><ShieldAlert /> Report incident</Link></Button> : undefined}
            emptyTitle="No incidents recorded"
            emptyDescription="This vehicle has a clean incident record."
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between"><EntityLink type="incident" id={r.id} /><Badge tone={INCIDENT_SEVERITY[r.severity]!.tone}>{INCIDENT_SEVERITY[r.severity]!.label}</Badge></div>
                <div className="text-[13px]">{INCIDENT_TYPE[r.type]} · {fmtDate(r.date)}</div>
                <div className="text-xs text-muted-foreground">{r.location}</div>
              </div>
            )}
          />
        </div>
        <ChartCard title="Safety events by type" description={`${events.length} recorded for this vehicle`}>
          <BarList
            items={stats.byType.map(([k, n], i) => ({ label: SAFETY_EVENT_TYPE[k as keyof typeof SAFETY_EVENT_TYPE], value: n, color: chartColor(i) }))}
            format={(n) => fmtNumber(n)}
            emptyText="No safety events recorded"
          />
        </ChartCard>
      </div>
      <DataTable<EventRow>
        tableId="vehicle-safety-events"
        exportName={`${v.reg.replace(' ', '')}-safety-events`}
        data={evRows}
        columns={evColumns}
        getRowId={(r) => r.id}
        defaultSort={[{ id: 'time', desc: true }]}
        defaultPageSize={10}
        searchPlaceholder="Search safety events…"
        facets={[
          { columnId: 'type', label: 'Event', options: Object.entries(SAFETY_EVENT_TYPE).map(([value, label]) => ({ value, label })) },
          { columnId: 'severity', label: 'Severity', options: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
        ]}
        emptyTitle="No safety events"
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between"><span className="text-[13px] font-medium">{SAFETY_EVENT_TYPE[r.type]}</span><Badge tone={r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warning' : 'neutral'}>{r.severity}</Badge></div>
            <div className="text-xs text-muted-foreground">{fmtDateTime(r.timestamp)} · {r.location}</div>
          </div>
        )}
      />
    </div>
  )
}

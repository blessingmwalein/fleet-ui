import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, FileUp, Mail, MapPin, Phone, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react'
import type { Driver } from '@/types'
import { useDb } from '@/store/db'
import { useMoney } from '@/hooks/useMoney'
import { useById } from '@/hooks/useLookup'
import { DetailGrid, Panel, Timeline } from '@/components/shared/Page'
import { BranchLink, EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { ExpiryBadge, Status } from '@/components/shared/Status'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/form-controls'
import { EXPENSE_CATEGORY, expiryState } from '@/config/status'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EMPLOYMENT_LABEL, ageOf, dispatchBlockers, tenureLabel, type DriverRow } from '../driverData'
import type { DriverDialogsApi } from '../DriverDialogs'

interface TabProps {
  driver: Driver
  row: DriverRow
  dlg: DriverDialogsApi
  canEdit: boolean
}

/* ================================================================================================ Personal */
export function PersonalTab({ driver, canEdit, dlg }: TabProps) {
  const audit = useDb((s) => s.auditLog)
  const history = useMemo(() => audit.filter((a) => a.entityType === 'driver' && a.entityId === driver.id && (a.action === 'status' || a.action === 'create')).slice(0, 8), [audit, driver.id])
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel title="Personal details" className="lg:col-span-2" actions={canEdit ? <Button variant="outline" size="xs" onClick={() => dlg.openEdit(driver.id)}>Edit</Button> : undefined}>
        <DetailGrid
          columns={3}
          items={[
            { label: 'Full name', value: driver.name },
            { label: 'National ID', value: <span className="font-mono text-xs">{driver.nationalId}</span> },
            { label: 'Date of birth', value: `${fmtDate(driver.dob)} · ${ageOf(driver.dob)} yrs` },
            { label: 'Gender', value: driver.gender === 'female' ? 'Female' : 'Male' },
            { label: 'Mobile phone', value: <a className="inline-flex items-center gap-1 hover:text-primary hover:underline" href={`tel:${driver.phone.replace(/\s/g, '')}`}><Phone className="size-3" />{driver.phone}</a> },
            { label: 'Email', value: <a className="inline-flex max-w-full items-center gap-1 hover:text-primary hover:underline" href={`mailto:${driver.email}`}><Mail className="size-3 shrink-0" /><span className="truncate">{driver.email}</span></a> },
            { label: 'Residential address', value: <span className="inline-flex items-center gap-1"><MapPin className="size-3 shrink-0 text-muted-foreground" />{driver.address}</span> },
            { label: 'Status', value: <Status kind="driver" value={driver.status} /> },
            { label: 'Branch', value: <BranchLink id={driver.branchId} /> },
          ]}
        />
        {driver.notes && (
          <div className="mt-4 rounded-md border border-border bg-surface-2/50 p-3">
            <div className="label-xs mb-1">Notes</div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{driver.notes}</p>
          </div>
        )}
      </Panel>

      <div className="space-y-3">
        <Panel title="Emergency contact">
          <DetailGrid columns={1} items={[{ label: 'Contact', value: driver.emergencyContact }, { label: 'Phone', value: <a className="inline-flex items-center gap-1 hover:text-primary hover:underline" href={`tel:${driver.emergencyPhone.replace(/\s/g, '')}`}><Phone className="size-3" />{driver.emergencyPhone}</a> }]} />
        </Panel>
        <Panel title="Status history" description="Recent changes from the audit log">
          {history.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">No status changes recorded.</p>
          ) : (
            <Timeline items={history.map((h) => ({ id: h.id, title: h.summary, description: h.userName, time: timeAgo(h.at), tone: h.action === 'status' ? 'primary' : 'default' }))} />
          )}
        </Panel>
      </div>
    </div>
  )
}

/* ================================================================================================ Employment */
export function EmploymentTab({ driver, canEdit, dlg }: TabProps) {
  const money = useMoney()
  const expenses = useDb((s) => s.expenses)
  const mine = useMemo(() => expenses.filter((e) => e.driverId === driver.id).sort((a, b) => b.date.localeCompare(a.date)), [expenses, driver.id])
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
  const ytd = (cat: string) => mine.filter((e) => e.category === cat && new Date(e.date).getTime() >= yearStart && e.status !== 'rejected').reduce((s, e) => s + e.amountUsd, 0)
  const milestones = [1, 3, 5, 10].map((y) => {
    const at = new Date(driver.hireDate).getTime() + y * 365.25 * 864e5
    return { y, at, done: at <= Date.now() }
  })
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel title="Employment" className="lg:col-span-2" actions={canEdit ? <Button variant="outline" size="xs" onClick={() => dlg.openEdit(driver.id)}>Edit</Button> : undefined}>
        <DetailGrid
          columns={3}
          items={[
            { label: 'Employee number', value: <span className="font-mono text-xs">{driver.empNo}</span> },
            { label: 'Hire date', value: fmtDate(driver.hireDate) },
            { label: 'Tenure', value: tenureLabel(driver.hireDate) },
            { label: 'Employment type', value: <Badge tone={driver.employmentType === 'permanent' ? 'success' : driver.employmentType === 'contract' ? 'info' : 'warning'}>{EMPLOYMENT_LABEL[driver.employmentType]}</Badge> },
            { label: 'Home branch', value: <BranchLink id={driver.branchId} /> },
            { label: 'Monthly salary', value: money(driver.salaryUsd) },
            { label: 'Allowances (YTD)', value: money(ytd('allowance')) },
            { label: 'Fines & penalties (YTD)', value: <span className={cn(ytd('fines') > 0 && 'text-danger')}>{money(ytd('fines'))}</span> },
            { label: 'Assigned vehicle', value: driver.vehicleId ? <VehicleLink id={driver.vehicleId} /> : <span className="text-subtle-foreground">Unassigned</span> },
          ]}
        />
        <div className="mt-5">
          <div className="label-xs mb-2">Service milestones</div>
          <Timeline
            items={[
              { id: 'hire', title: 'Joined the company', time: fmtDate(driver.hireDate), description: `${EMPLOYMENT_LABEL[driver.employmentType]} contract at ${money(driver.salaryUsd)} / month` },
              ...milestones.map((m) => ({ id: `m${m.y}`, title: `${m.y}-year service anniversary`, time: fmtDate(m.at), done: m.done })),
            ]}
          />
        </div>
      </Panel>
      <Panel title="Expense claims" description={`${mine.length} claim${mine.length === 1 ? '' : 's'} linked to this driver`} bodyClassName="p-0">
        {mine.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">No expenses recorded.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {mine.slice(0, 9).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3.5 py-2">
                <div className="min-w-0">
                  <EntityLink type="expense" id={e.id} className="text-[13px] font-medium" />
                  <p className="truncate text-xs text-muted-foreground">{EXPENSE_CATEGORY[e.category]} · {fmtDate(e.date)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[13px] font-medium">{money(e.amountUsd, { digits: 2 })}</div>
                  <Status kind="expense" value={e.status} dot={false} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

/* ================================================================================================ Licence & compliance */
export function ComplianceTab({ driver, canEdit, dlg }: TabProps) {
  const documents = useDb((s) => s.documents)
  const docs = useMemo(() => documents.filter((d) => d.entityType === 'driver' && d.entityId === driver.id), [documents, driver.id])
  const issues = dispatchBlockers(driver)
  const cards = [
    { type: 'driver_licence', title: 'Driving licence', iso: driver.licenceExpiry, valid: 5 * 365, lines: [`No. ${driver.licenceNo}`, driver.licenceClass] },
    { type: 'medical', title: 'Medical certificate', iso: driver.medicalExpiry, valid: 365, lines: [docs.find((d) => d.type === 'medical')?.issuer ?? 'Occupational health'] },
    { type: 'defensive_driving', title: 'Defensive-driving training', iso: driver.defensiveDrivingExpiry, valid: 2 * 365, lines: [docs.find((d) => d.type === 'defensive_driving')?.issuer ?? 'TSCZ'] },
  ]
  const blocked = issues.some((i) => i.severity === 'block')
  return (
    <div className="space-y-3">
      <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3', blocked ? 'border-danger/40 bg-danger/10' : issues.length ? 'border-warning/40 bg-warning/10' : 'border-success/30 bg-success/10')}>
        {blocked ? <ShieldX className="size-5 text-danger" /> : issues.length ? <TriangleAlert className="size-5 text-warning" /> : <ShieldCheck className="size-5 text-success" />}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{blocked ? 'Not eligible for dispatch' : issues.length ? 'Eligible — action needed soon' : 'Fully compliant and eligible for dispatch'}</p>
          <p className="text-xs text-muted-foreground">{issues.length ? issues.map((i) => i.label).join(' · ') : 'Licence, medical certificate and defensive-driving training are in date and the driver is rostered.'}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((c) => {
          const e = expiryState(c.iso, 30)
          const pct = e.state === 'expired' ? 0 : Math.min(100, Math.round((e.days / c.valid) * 100))
          return (
            <Panel key={c.type} title={c.title} actions={<ExpiryBadge iso={c.iso} />}>
              <div className="num text-lg font-semibold leading-tight">{fmtDate(c.iso)}</div>
              <p className="mb-3 text-xs text-muted-foreground">{e.state === 'expired' ? `Expired ${-e.days} days ago` : `${e.days} days remaining`}</p>
              <Progress value={pct} indicatorClassName={e.tone === 'danger' ? 'bg-danger' : e.tone === 'warning' ? 'bg-warning' : 'bg-success'} aria-label={`${c.title} validity remaining`} />
              <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">{c.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => dlg.openDocument(driver.id, c.type)}>
                  <FileUp /> Renew / upload certificate
                </Button>
              )}
            </Panel>
          )
        })}
      </div>

      <Panel title="Compliance documents" description="Latest certificates on file" bodyClassName="p-0" actions={<Button variant="ghost" size="xs" asChild><Link to="?tab=documents">All documents</Link></Button>}>
        {docs.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">No documents uploaded.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {docs.slice().sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2 text-[13px]">
                <span className="w-44 shrink-0 font-medium">{d.type.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase())}</span>
                <span className="font-mono text-xs text-muted-foreground">{d.number}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{d.issuer}</span>
                <span className="num text-xs text-muted-foreground"><Calendar className="mr-1 inline size-3" />{fmtDate(d.issueDate)} → {fmtDate(d.expiryDate)}</span>
                <ExpiryBadge iso={d.expiryDate} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

/** Re-export used by the detail page header. */
export function useVehicleOf(driver: Driver) {
  return useById('vehicles')(driver.vehicleId)
}
export { fmtDateTime }

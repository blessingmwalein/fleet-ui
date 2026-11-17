import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Building2, Factory, LayoutGrid, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, Rows3, Star, Trash2, Wallet, Warehouse, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import type { ServiceProvider } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { useOpenParam } from '@/hooks/useLookup'
import { FormDialog } from '@/components/forms/FormDialog'
import { FormGrid, NumberField, SelectField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { Status } from '@/components/shared/Status'
import { DataTable, actionsColumn, type FacetFilter } from '@/components/data-table/DataTable'
import { BarList } from '@/components/charts/charts'
import { fmtDate, fmtNumber, timeAgo } from '@/lib/format'
import { WORKORDER_TYPE } from '@/config/status'
import { saveProvider } from './lib/actions'
import { EMPTY_PROVIDER_STAT, useProviderStats, type ProviderStat } from './lib/data'
import { PROVIDER_STATUS, TYPE_COLOR, bayBranchFor, woCost } from './lib/maintenance'
import { Stars } from './components/bits'

const schemaFor = (existing: ServiceProvider | null, all: ServiceProvider[]) =>
  z.object({
    name: z.string().trim().min(3, 'Enter the provider name').max(80, 'Max. 80 characters').refine((n) => !all.some((p) => p.id !== existing?.id && p.name.toLowerCase() === n.toLowerCase()), 'A provider with this name already exists'),
    type: z.enum(['internal', 'external']),
    city: z.string().trim().min(2, 'Enter the city').max(40),
    specialties: z.string().trim().min(2, 'List at least one specialty (comma separated)').max(200),
    contactName: z.string().trim().min(2, 'Enter a contact person').max(60),
    phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number'),
    email: z.email('Enter a valid email address'),
    rating: z.number({ error: 'Enter a rating' }).min(1, 'Min. 1').max(5, 'Max. 5'),
    status: z.enum(['preferred', 'approved', 'on_hold']),
    hourlyRateUsd: z.number({ error: 'Enter the hourly rate' }).min(1, 'Must be at least 1').max(500, 'Unrealistically high'),
  })

function ProviderFormDialog({ open, onOpenChange, provider }: { open: boolean; onOpenChange: (o: boolean) => void; provider: ServiceProvider | null }) {
  const providers = useDb((s) => s.providers)
  const schema = useMemo(() => schemaFor(provider, providers), [provider, providers])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={provider ? `Edit ${provider.name}` : 'Add service provider'}
      description="Internal workshops use depot bays; external providers are contracted garages and specialists."
      schema={schema}
      defaultValues={provider ? { ...provider, specialties: provider.specialties.join(', ') } : { name: '', type: 'external', city: '', specialties: '', contactName: '', phone: '+263 ', email: '', rating: 4, status: 'approved', hourlyRateUsd: undefined as unknown as number }}
      submitLabel={provider ? 'Save changes' : 'Add provider'}
      onSubmit={(v) => saveProvider(provider, { ...v, specialties: v.specialties.split(',').map((s) => s.trim()).filter(Boolean) })}
    >
      {(form) => (
        <>
          <TextField form={form} name="name" label="Provider name" required placeholder="e.g. Apex Truck Service Centre" />
          <FormGrid>
            <SelectField form={form} name="type" label="Type" required options={[{ value: 'external', label: 'External provider' }, { value: 'internal', label: 'Internal workshop' }]} />
            <SelectField form={form} name="status" label="Status" required options={[{ value: 'preferred', label: 'Preferred' }, { value: 'approved', label: 'Approved' }, { value: 'on_hold', label: 'On hold' }]} />
            <TextField form={form} name="city" label="City" required placeholder="Harare" />
            <NumberField form={form} name="hourlyRateUsd" label="Hourly labour rate" required suffix="USD/h" min={0} />
          </FormGrid>
          <TextField form={form} name="specialties" label="Specialties" required placeholder="Engines, Gearboxes, Heavy trucks" hint="Separate with commas" />
          <FormGrid>
            <TextField form={form} name="contactName" label="Contact person" required />
            <TextField form={form} name="phone" label="Phone" required inputMode="tel" />
            <TextField form={form} name="email" label="Email" required type="email" />
            <NumberField form={form} name="rating" label="Rating (1–5)" required min={1} max={5} step={0.1} />
          </FormGrid>
        </>
      )}
    </FormDialog>
  )
}

export default function ProvidersPage() {
  const providers = useDb((s) => s.providers)
  const workOrders = useDb((s) => s.workOrders)
  const branches = useDb((s) => s.branches)
  const stats = useProviderStats()
  const money = useMoney()
  const canCreate = useCan('maintenance.create')
  const canEdit = useCan('maintenance.edit')
  const canDelete = useCan('maintenance.delete')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [openId, setOpenId] = useOpenParam()
  const [params, setParams] = useSearchParams()
  const [form, setForm] = useState<{ open: boolean; provider: ServiceProvider | null }>({ open: false, provider: null })

  useEffect(() => {
    if (params.get('new') !== '1') return
    if (canCreate) setForm({ open: true, provider: null })
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => providers.map((p) => ({ ...p, ...(stats.get(p.id) ?? EMPTY_PROVIDER_STAT), statusLabel: PROVIDER_STATUS[p.status].label, typeLabel: p.type === 'internal' ? 'Internal' : 'External', specialtiesText: p.specialties.join(', ') })), [providers, stats])
  type Row = (typeof rows)[number]

  const bays = useMemo(
    () => providers.filter((p) => p.type === 'internal').map((p) => {
      const branch = bayBranchFor(p, branches)
      const inShop = workOrders.filter((w) => w.providerId === p.id && w.status === 'in_progress')
      const queue = workOrders.filter((w) => w.providerId === p.id && (w.status === 'scheduled' || w.status === 'approved')).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
      return { provider: p, branch, capacity: branch?.bayCapacity ?? 0, inShop, queue }
    }),
    [providers, branches, workOrders],
  )
  const totals = useMemo(() => {
    const cap = bays.reduce((s, b) => s + b.capacity, 0)
    const used = bays.reduce((s, b) => s + b.inShop.length, 0)
    return { util: cap ? (used / cap) * 100 : 0, used, cap, spend: rows.reduce((s, r) => s + r.spend, 0), rating: rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0, preferred: rows.filter((r) => r.status === 'preferred').length }
  }, [bays, rows])

  const remove = async (p: ServiceProvider) => {
    const used = workOrders.filter((w) => w.providerId === p.id).length
    if (used) return void toast.error(`${p.name} has ${used} work order${used > 1 ? 's' : ''} on record`, { description: 'Put the provider on hold instead of deleting it.' })
    if (await confirm({ title: `Delete ${p.name}?`, description: 'The provider is removed from the directory. This cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
      useDb.getState().remove('providers', p.id)
      toast.success(`${p.name} deleted`)
      setOpenId(null)
    }
  }

  const menu = (p: ServiceProvider) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`} onClick={(e) => e.stopPropagation()}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        {canEdit && <DropdownMenuItem onSelect={() => setForm({ open: true, provider: p })}><Pencil /> Edit provider</DropdownMenuItem>}
        {canEdit && p.status !== 'on_hold' && <DropdownMenuItem onSelect={() => { useDb.getState().update('providers', p.id, { status: 'on_hold' }, { action: 'status', summary: `Put service provider ${p.name} on hold` }); toast.success(`${p.name} put on hold`) }}>Put on hold</DropdownMenuItem>}
        {canEdit && p.status === 'on_hold' && <DropdownMenuItem onSelect={() => { useDb.getState().update('providers', p.id, { status: 'approved' }, { action: 'status', summary: `Reinstated service provider ${p.name}` }); toast.success(`${p.name} reinstated`) }}>Reinstate</DropdownMenuItem>}
        {canDelete && <><DropdownMenuSeparator /><DropdownMenuItem destructive onSelect={() => void remove(p)}><Trash2 /> Delete</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const facets: FacetFilter[] = [
    { columnId: 'typeLabel', label: 'Type', options: [{ value: 'Internal', label: 'Internal' }, { value: 'External', label: 'External' }] },
    { columnId: 'statusLabel', label: 'Status', options: Object.values(PROVIDER_STATUS).map((s) => ({ value: s.label, label: s.label })) },
    { columnId: 'city', label: 'City', options: [...new Set(providers.map((p) => p.city))].sort().map((c) => ({ value: c, label: c })) },
  ]

  const columns = useMemo<ColumnDef<Row, any>[]>(
    () => [
      { accessorKey: 'name', header: 'Provider', size: 240, cell: ({ row }) => <button type="button" className="truncate font-medium hover:text-primary hover:underline" onClick={() => setOpenId(row.original.id)}>{row.original.name}</button> },
      { accessorKey: 'typeLabel', header: 'Type', size: 90 },
      { accessorKey: 'city', header: 'City', size: 100 },
      { accessorKey: 'specialtiesText', header: 'Specialties', size: 260, meta: { label: 'Specialties' } },
      { accessorKey: 'contactName', header: 'Contact', size: 140 },
      { accessorKey: 'rating', header: 'Rating', size: 130, cell: ({ row }) => <Stars value={row.original.rating} /> },
      { accessorKey: 'statusLabel', header: 'Status', size: 100, cell: ({ row }) => <Badge tone={PROVIDER_STATUS[row.original.status].tone}>{row.original.statusLabel}</Badge> },
      { accessorKey: 'hourlyRateUsd', header: 'Rate / h', size: 90, meta: { align: 'right' }, cell: ({ row }) => money(row.original.hourlyRateUsd) },
      { accessorKey: 'jobs', header: 'Jobs', size: 70, meta: { align: 'right' } },
      { accessorKey: 'open', header: 'Open', size: 70, meta: { align: 'right' } },
      { accessorKey: 'spend', header: 'Spend', size: 100, meta: { align: 'right' }, cell: ({ row }) => money(row.original.spend) },
      { accessorKey: 'avgCost', header: 'Avg / job', size: 100, meta: { align: 'right' }, cell: ({ row }) => money(row.original.avgCost) },
      { accessorKey: 'phone', header: 'Phone', size: 140 },
      { accessorKey: 'email', header: 'Email', size: 220 },
      actionsColumn<Row>((p) => [
        { label: 'View details', icon: <Building2 />, onClick: () => setOpenId(p.id) },
        { label: 'Edit provider', icon: <Pencil />, onClick: () => setForm({ open: true, provider: p }), hidden: !canEdit },
        { label: 'Delete', icon: <Trash2 />, onClick: () => void remove(p), hidden: !canDelete, destructive: true, separatorBefore: true },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, canEdit, canDelete, workOrders],
  )

  const selected = providers.find((p) => p.id === openId)
  const selStats: ProviderStat = (selected && stats.get(selected.id)) || EMPTY_PROVIDER_STAT
  const selJobs = useMemo(() => (selected ? workOrders.filter((w) => w.providerId === selected.id).sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate)) : []), [selected, workOrders])
  const selByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of selJobs) if (w.status === 'completed') m.set(w.type, (m.get(w.type) ?? 0) + woCost(w))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [selJobs])

  return (
    <Page>
      <PageHeader
        title="Service providers"
        description="Internal workshops and external garages — ratings, specialties, spend and workshop bay capacity."
        actions={canCreate && <Button onClick={() => setForm({ open: true, provider: null })}><Plus /> Add provider</Button>}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Providers" value={providers.length} icon={Building2} hint={`${providers.filter((p) => p.type === 'internal').length} internal · ${providers.filter((p) => p.type === 'external').length} external`} />
        <KpiCard label="Preferred" value={totals.preferred} icon={Star} status="success" />
        <KpiCard label="Average rating" value={totals.rating.toFixed(1)} unit="/ 5" icon={Star} />
        <KpiCard label="Total spend" value={money(totals.spend)} icon={Wallet} hint="Completed work orders, all time" />
        <KpiCard label="Bay utilisation" value={totals.util} format={(n) => `${n.toFixed(0)}%`} icon={Warehouse} status={totals.util > 85 ? 'danger' : 'success'} hint={`${totals.used} of ${totals.cap} internal bays occupied`} />
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        {bays.map((b) => {
          const pct = b.capacity ? (b.inShop.length / b.capacity) * 100 : 0
          return (
            <Panel key={b.provider.id} title={<span className="flex items-center gap-2"><Factory className="size-3.5 text-muted-foreground" />{b.provider.name}</span>} description={b.branch ? `${b.branch.name} · ${b.capacity} bays` : b.provider.city} actions={<span className="num text-xs text-muted-foreground">{b.inShop.length} / {b.capacity} bays</span>}>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-3"><div className={`h-full rounded-full transition-[width] duration-500 ${pct > 85 ? 'bg-danger' : pct > 60 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.max(pct, b.inShop.length ? 3 : 0)}%` }} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="label-xs mb-1.5">In the workshop now</p>
                  {b.inShop.length === 0 ? <p className="text-xs text-muted-foreground">All bays free.</p> : (
                    <ul className="space-y-1.5">{b.inShop.slice(0, 4).map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-2 text-[13px]"><VehicleLink id={w.vehicleId} /><EntityLink type="workorder" id={w.id} className="num text-xs text-muted-foreground" /><span className="text-xs text-subtle-foreground">{w.startedAt ? timeAgo(w.startedAt).replace(' ago', '') : ''}</span></li>
                    ))}</ul>
                  )}
                </div>
                <div>
                  <p className="label-xs mb-1.5">Queue ({b.queue.length})</p>
                  {b.queue.length === 0 ? <p className="text-xs text-muted-foreground">No jobs waiting.</p> : (
                    <ul className="space-y-1.5">{b.queue.slice(0, 4).map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-2 text-[13px]"><VehicleLink id={w.vehicleId} /><EntityLink type="workorder" id={w.id} className="num text-xs text-muted-foreground" /><span className="text-xs text-subtle-foreground">{fmtDate(w.scheduledDate, 'dd MMM')}</span></li>
                    ))}</ul>
                  )}
                </div>
              </div>
            </Panel>
          )
        })}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Directory</h2>
        <Segmented<'cards' | 'table'> aria-label="Directory view" value={view} onChange={setView} options={[{ value: 'cards', label: <><LayoutGrid className="size-3.5" /> Cards</> }, { value: 'table', label: <><Rows3 className="size-3.5" /> Table</> }]} />
      </div>

      {view === 'table' ? (
        <DataTable
          tableId="maintenance-providers"
          exportName="service-providers"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          facets={facets}
          searchPlaceholder="Search providers, specialties, cities…"
          defaultHidden={['phone', 'email', 'avgCost']}
          onRowClick={(r) => setOpenId(r.id)}
          mobileCard={(r) => (
            <div className="space-y-1"><div className="flex items-center justify-between"><span className="font-medium">{r.name}</span><Badge tone={PROVIDER_STATUS[r.status].tone}>{r.statusLabel}</Badge></div><Stars value={r.rating} /><p className="text-xs text-muted-foreground">{r.city} · {r.specialtiesText}</p></div>
          )}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} role="button" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)} className="panel cursor-pointer p-3.5 transition-colors hover:border-border-strong hover:bg-surface-2/50 focus-visible:ring-2 focus-visible:ring-ring/50 outline-none">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[13px] font-semibold">{r.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" />{r.city} · {r.typeLabel}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge tone={PROVIDER_STATUS[r.status].tone}>{r.statusLabel}</Badge>
                  {(canEdit || canDelete) && menu(r)}
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between"><Stars value={r.rating} /><span className="num text-xs text-muted-foreground">{money(r.hourlyRateUsd)} / h</span></div>
              <div className="mt-2.5 flex flex-wrap gap-1">{r.specialties.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}</div>
              <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-2.5 text-center">
                {[['Jobs', fmtNumber(r.jobs)], ['Open', fmtNumber(r.open)], ['Spend', money(r.spend, { compact: true })], ['Avg job', money(r.avgCost, { compact: true })]].map(([l, v]) => (
                  <div key={l}><div className="num text-[13px] font-semibold">{v}</div><div className="text-[11px] text-subtle-foreground">{l}</div></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent size="lg">
          {!selected ? (
            <>
              <SheetHeader><SheetTitle>Service provider</SheetTitle><SheetDescription>Details</SheetDescription></SheetHeader>
              <EmptyState icon={Wrench} title="Provider not found" description="It may have been deleted or the link is out of date." />
            </>
          ) : (
            <>
              <SheetHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6"><SheetTitle>{selected.name}</SheetTitle><Badge tone={PROVIDER_STATUS[selected.status].tone}>{PROVIDER_STATUS[selected.status].label}</Badge></div>
                <SheetDescription>{selected.type === 'internal' ? 'Internal workshop' : 'External provider'} · {selected.city}</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <div className="flex items-center justify-between"><Stars value={selected.rating} /><span className="num text-[13px]">{money(selected.hourlyRateUsd)} / hour</span></div>
                <div className="flex flex-wrap gap-1">{selected.specialties.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[['Jobs', fmtNumber(selStats.jobs)], ['Open', fmtNumber(selStats.open)], ['Spend', money(selStats.spend)], ['Avg downtime', `${selStats.avgDowntime.toFixed(1)} h`]].map(([l, v]) => (
                    <div key={l} className="rounded-lg border border-border bg-surface-2/50 px-3 py-2"><div className="label-xs">{l}</div><div className="num mt-0.5 text-base font-semibold">{v}</div></div>
                  ))}
                </div>
                <DetailGrid items={[
                  { label: 'Contact', value: selected.contactName },
                  { label: 'Avg cost per job', value: money(selStats.avgCost) },
                  { label: 'Phone', value: <a className="inline-flex items-center gap-1 hover:text-primary hover:underline" href={`tel:${selected.phone.replace(/\s/g, '')}`}><Phone className="size-3" />{selected.phone}</a> },
                  { label: 'Email', value: <a className="inline-flex items-center gap-1 hover:text-primary hover:underline" href={`mailto:${selected.email}`}><Mail className="size-3" />{selected.email}</a> },
                  { label: 'Last completed job', value: selStats.lastJobAt ? fmtDate(selStats.lastJobAt) : '—' },
                ]} />
                {selByType.length > 0 && (
                  <Panel title="Spend by work type">
                    <BarList items={selByType.map(([t, v]) => ({ label: WORKORDER_TYPE[t as keyof typeof WORKORDER_TYPE], value: v, color: TYPE_COLOR[t as keyof typeof TYPE_COLOR] }))} format={(v) => money(v)} />
                  </Panel>
                )}
                <Panel title="Recent work orders" description={`${selJobs.length} total`} flush>
                  {selJobs.length === 0 ? <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">No work orders yet.</p> : (
                    <ul className="divide-y divide-border/70">
                      {selJobs.slice(0, 8).map((w) => (
                        <li key={w.id} className="flex items-center gap-3 px-3.5 py-2 text-[13px]">
                          <EntityLink type="workorder" id={w.id} className="num shrink-0" />
                          <VehicleLink id={w.vehicleId} />
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{w.title}</span>
                          <Status kind="workorder" value={w.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </SheetBody>
              <SheetFooter>
                {canDelete && <Button variant="outline" className="mr-auto text-danger" onClick={() => void remove(selected)}><Trash2 /> Delete</Button>}
                {canEdit && <Button onClick={() => setForm({ open: true, provider: selected })}><Pencil /> Edit provider</Button>}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ProviderFormDialog open={form.open} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} provider={form.provider} />
    </Page>
  )
}

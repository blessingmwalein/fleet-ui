import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { addMonths } from 'date-fns'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRightLeft, CreditCard, Eye, Gauge, Link2, Lock, LockOpen, Plus, RefreshCw, Trash2, Unlink, Wallet } from 'lucide-react'
import type { FuelCard } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge, type Tone } from '@/components/ui/display'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction } from '@/components/data-table/DataTable'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, NumberField, SelectField, toInputDate, fromInputDate } from '@/components/forms/fields'
import { EmptyState } from '@/components/shared/EmptyState'
import { VehicleLink, DriverLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { ExpiryBadge, Plate } from '@/components/shared/Status'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useBranchScope } from '@/hooks/useFilters'
import { getById, useOpenParam } from '@/hooks/useLookup'
import { useMoney } from '@/hooks/useMoney'
import { useVehicleOptions } from '@/hooks/useOptions'
import { expiryState } from '@/config/status'
import { fmtDate, fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Stat, UtilisationBar } from './components'
import { useFuelPerms, useFuelRows, useNewParam } from './hooks'

type CardState = 'active' | 'blocked' | 'expired' | 'unassigned'
const STATE_META: Record<CardState, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  blocked: { label: 'Blocked', tone: 'danger' },
  expired: { label: 'Expired', tone: 'warning' },
  unassigned: { label: 'Spare', tone: 'neutral' },
}
const PROVIDERS = ['Puma Energy FleetCard', 'Zuva FuelPass', 'TotalEnergies Fleet']

interface CardRow extends FuelCard {
  state: CardState
  reg: string
  model: string
  driverId: string | null
  driverName: string
  branchId: string
  utilPct: number
  lastUsed: string | null
  fills: number
}

const effectiveState = (c: FuelCard): CardState => (c.status === 'expired' || new Date(c.expiry).getTime() < Date.now() ? 'expired' : c.status)

const maskedNumber = () => {
  const taken = new Set(useDb.getState().fuelCards.map((c) => c.number))
  for (let i = 0; i < 50; i++) {
    const n = `5412 •••• ${Math.floor(1000 + Math.random() * 9000)}`
    if (!taken.has(n)) return n
  }
  return `5412 •••• ${Date.now() % 10000}`
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function patchCard(c: FuelCard, patch: Partial<FuelCard>, summary: string, action?: 'status' | 'assign') {
  useDb.getState().update('fuelCards', c.id, patch, { summary, action })
}

async function blockCard(c: CardRow) {
  if (!(await confirm({ title: `Block card ${c.number}?`, description: `${c.reg !== '—' ? c.reg + ' ' : ''}will be declined at every pump until the card is unblocked.`, confirmLabel: 'Block card', destructive: true }))) return
  patchCard(c, { status: 'blocked' }, `Blocked fuel card ${c.number}`, 'status')
  toast.success(`Card ${c.number} blocked`)
}
function unblockCard(c: CardRow) {
  if (c.state === 'expired') return void toast.error('This card has expired — issue a replacement instead')
  patchCard(c, { status: c.vehicleId ? 'active' : 'unassigned' }, `Unblocked fuel card ${c.number}`, 'status')
  toast.success(`Card ${c.number} unblocked`)
}
async function unassignCard(c: CardRow) {
  if (!(await confirm({ title: `Unassign ${c.number}?`, description: `The card is detached from ${c.reg} and becomes a spare card.`, confirmLabel: 'Unassign' }))) return
  patchCard(c, { vehicleId: null, status: c.state === 'expired' ? 'expired' : 'unassigned' }, `Unassigned fuel card ${c.number} from ${c.reg}`, 'assign')
  toast.success(`Card ${c.number} unassigned`)
}
async function replaceCard(c: CardRow) {
  if (!(await confirm({ title: `Replace card ${c.number}?`, description: `A new card with the same limit is issued${c.vehicleId ? ` and assigned to ${c.reg}` : ''}. The old card is cancelled immediately.`, confirmLabel: 'Issue replacement' }))) return
  const db = useDb.getState()
  const now = new Date()
  const fresh = db.insert(
    'fuelCards',
    { number: maskedNumber(), vehicleId: c.vehicleId, provider: c.provider, status: c.vehicleId ? 'active' : 'unassigned', monthlyLimitUsd: c.monthlyLimitUsd, spentThisMonthUsd: 0, expiry: addMonths(now, 36).toISOString(), pinSetAt: now.toISOString() },
    { summary: `Issued replacement fuel card for ${c.number}` },
  )
  patchCard(c, { vehicleId: null, status: c.state === 'expired' ? 'expired' : 'blocked' }, `Cancelled fuel card ${c.number} (replaced by ${fresh.number})`, 'status')
  toast.success(`Replacement ${fresh.number} issued`, { description: c.vehicleId ? `Assigned to ${c.reg}` : 'Added as a spare card' })
}
async function retireCard(rows: CardRow[]) {
  const ok = await confirm({ title: rows.length === 1 ? `Delete card ${rows[0]!.number}?` : `Delete ${rows.length} cards?`, description: 'Cards are removed from the register. Past transactions keep their reference. This is audit-logged.', confirmLabel: 'Delete', destructive: true })
  if (!ok) return false
  useDb.getState().removeMany('fuelCards', rows.map((r) => r.id))
  toast.success(rows.length === 1 ? 'Card deleted' : `${rows.length} cards deleted`)
  return true
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
function vehicleHasLiveCard(vehicleId: string, exceptCardId?: string) {
  return useDb.getState().fuelCards.find((c) => c.vehicleId === vehicleId && c.id !== exceptCardId && effectiveState(c) === 'active')
}
const issueSchema = z
  .object({
    provider: z.string().min(1, 'Select a provider'),
    monthlyLimitUsd: z.number({ error: 'Enter a monthly limit' }).min(100, 'Minimum limit is $100').max(50000, 'Maximum limit is $50,000'),
    expiry: z.string().min(1, 'Expiry is required'),
    vehicleId: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.expiry && new Date(fromInputDate(v.expiry)).getTime() < Date.now() + 30 * 864e5) ctx.addIssue({ code: 'custom', path: ['expiry'], message: 'Expiry must be at least 30 days from today' })
    const live = v.vehicleId ? vehicleHasLiveCard(v.vehicleId) : null
    if (live) ctx.addIssue({ code: 'custom', path: ['vehicleId'], message: `Vehicle already has an active card (${live.number}) — block or unassign it first` })
  })
const assignSchema = z.object({ cardId: z.string(), vehicleId: z.string().min(1, 'Select a vehicle') }).superRefine((v, ctx) => {
  const live = vehicleHasLiveCard(v.vehicleId, v.cardId)
  if (live) ctx.addIssue({ code: 'custom', path: ['vehicleId'], message: `Vehicle already has an active card (${live.number}) — block or unassign it first` })
})
const limitSchema = z
  .object({ spent: z.number(), monthlyLimitUsd: z.number({ error: 'Enter a monthly limit' }).min(100, 'Minimum limit is $100').max(50000, 'Maximum limit is $50,000') })
  .refine((v) => v.monthlyLimitUsd >= v.spent, { path: ['monthlyLimitUsd'], message: 'Limit cannot be below spend this month' })

export default function CardsPage() {
  const money = useMoney()
  const perms = useFuelPerms()
  const { scope } = useBranchScope()
  const cards = useDb((s) => s.fuelCards)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const txRows = useFuelRows()
  const vehicleOptions = useVehicleOptions()
  const [openId, setOpenId] = useOpenParam()
  const [dialog, setDialog] = useState<{ kind: 'issue' | 'assign' | 'limit'; card?: CardRow } | null>(null)
  useNewParam(() => setDialog({ kind: 'issue' }), perms.canManage)

  const rows = useMemo<CardRow[]>(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const dById = new Map(drivers.map((d) => [d.id, d]))
    const last = new Map<string, { date: string; n: number }>()
    for (const t of txRows) {
      if (!t.cardId) continue
      const e = last.get(t.cardId)
      if (!e) last.set(t.cardId, { date: t.date, n: 1 })
      else {
        e.n++
        if (t.date > e.date) e.date = t.date
      }
    }
    return cards.map((c) => {
      const v = c.vehicleId ? vById.get(c.vehicleId) : undefined
      const d = v?.driverId ? dById.get(v.driverId) : undefined
      return { ...c, state: effectiveState(c), reg: v?.reg ?? '—', model: v ? `${v.make} ${v.model}` : '', driverId: v?.driverId ?? null, driverName: d?.name ?? '', branchId: v?.branchId ?? 'all', utilPct: c.monthlyLimitUsd ? (c.spentThisMonthUsd / c.monthlyLimitUsd) * 100 : 0, lastUsed: last.get(c.id)?.date ?? null, fills: last.get(c.id)?.n ?? 0 }
    })
  }, [cards, vehicles, drivers, txRows])

  const data = useMemo(() => {
    const ids = new Set(scope(rows.filter((r) => r.vehicleId)).map((r) => r.id))
    return rows.filter((r) => !r.vehicleId || ids.has(r.id))
  }, [rows, scope])
  const openRow = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId])

  const stats = useMemo(() => {
    const active = data.filter((r) => r.state === 'active')
    const limit = active.reduce((a, r) => a + r.monthlyLimitUsd, 0)
    const spent = active.reduce((a, r) => a + r.spentThisMonthUsd, 0)
    return { active: active.length, blocked: data.filter((r) => r.state === 'blocked').length, expired: data.filter((r) => r.state === 'expired').length, spare: data.filter((r) => r.state === 'unassigned').length, limit, spent }
  }, [data])

  const alerts = useMemo(() => {
    const out: { id: string; tone: 'danger' | 'warning' | 'info'; title: string; detail: string; row: CardRow; label?: string; run?: () => void }[] = []
    for (const r of data) {
      const exp = expiryState(r.expiry, 45)
      if (r.state === 'expired' && r.vehicleId) out.push({ id: `${r.id}-exp`, tone: 'danger', title: `${r.reg} has an expired card`, detail: `${r.number} · ${exp.label}`, row: r, label: 'Replace', run: () => void replaceCard(r) })
      else if (r.state === 'active' && exp.state === 'expiring') out.push({ id: `${r.id}-soon`, tone: 'warning', title: `${r.reg} card expires soon`, detail: `${r.number} · ${exp.label}`, row: r, label: 'Replace', run: () => void replaceCard(r) })
      if (r.state === 'active' && r.utilPct >= 85) out.push({ id: `${r.id}-lim`, tone: r.utilPct >= 100 ? 'danger' : 'warning', title: `${r.reg} at ${Math.round(r.utilPct)}% of monthly limit`, detail: `${money(r.spentThisMonthUsd)} of ${money(r.monthlyLimitUsd)} spent`, row: r, label: 'Raise limit', run: () => setDialog({ kind: 'limit', card: r }) })
      if (r.state === 'blocked' && r.vehicleId) out.push({ id: `${r.id}-blk`, tone: 'info', title: `${r.reg} card is blocked`, detail: `${r.number} · vehicle cannot refuel on card`, row: r, label: 'Unblock', run: () => unblockCard(r) })
    }
    const rank = { danger: 0, warning: 1, info: 2 }
    return out.sort((a, b) => rank[a.tone] - rank[b.tone])
  }, [data, money])

  const spare = useMemo(() => data.filter((r) => r.state === 'unassigned'), [data])

  const columns = useMemo<ColumnDef<CardRow, any>[]>(
    () => [
      { id: 'number', header: 'Card', size: 190, accessorFn: (r) => r.number, cell: ({ row }) => (<div className="leading-tight"><div className="num font-medium">{row.original.number}</div><div className="truncate text-[11px] text-subtle-foreground">{row.original.provider}</div></div>) },
      { id: 'vehicle', header: 'Vehicle', size: 140, accessorFn: (r) => r.reg, cell: ({ row }) => (row.original.vehicleId ? <VehicleLink id={row.original.vehicleId} /> : <span className="text-subtle-foreground">Unassigned</span>) },
      { id: 'driver', header: 'Driver', size: 150, accessorFn: (r) => r.driverName, cell: ({ row }) => <DriverLink id={row.original.driverId} /> },
      { id: 'status', header: 'Status', size: 100, accessorFn: (r) => STATE_META[r.state].label, cell: ({ row }) => <Badge tone={STATE_META[row.original.state].tone}>{STATE_META[row.original.state].label}</Badge> },
      { id: 'limit', header: 'Monthly limit', size: 115, accessorFn: (r) => r.monthlyLimitUsd, cell: ({ row }) => money(row.original.monthlyLimitUsd), meta: { align: 'right', exportValue: (r) => r.monthlyLimitUsd } },
      { id: 'spent', header: 'Spent', size: 100, accessorFn: (r) => r.spentThisMonthUsd, cell: ({ row }) => money(row.original.spentThisMonthUsd), meta: { align: 'right', exportValue: (r) => r.spentThisMonthUsd } },
      { id: 'util', header: 'Utilisation', size: 160, accessorFn: (r) => Math.round(r.utilPct), cell: ({ row }) => (row.original.vehicleId ? <UtilisationBar pct={row.original.utilPct} /> : <span className="text-subtle-foreground">—</span>), meta: { exportValue: (r) => Math.round(r.utilPct) } },
      { id: 'expiry', header: 'Expiry', size: 170, accessorFn: (r) => r.expiry, cell: ({ row }) => (<span className="flex items-center gap-2"><span className="num text-muted-foreground">{fmtDate(row.original.expiry, 'MMM yyyy')}</span><ExpiryBadge iso={row.original.expiry} warnDays={45} showValid={false} /></span>), meta: { exportValue: (r) => r.expiry.slice(0, 10) } },
      { id: 'lastUsed', header: 'Last used', size: 110, accessorFn: (r) => r.lastUsed ?? '', cell: ({ row }) => <span className="text-muted-foreground">{row.original.lastUsed ? timeAgo(row.original.lastUsed) : '—'}</span> },
      { id: 'provider', header: 'Provider', size: 160, accessorFn: (r) => r.provider },
      actionsColumn<CardRow>((r) => rowActions(r)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, perms.canEdit, perms.canDelete],
  )

  function rowActions(r: CardRow) {
    const e = perms.canEdit
    return [
      { label: 'View details', icon: <Eye />, onClick: () => setOpenId(r.id) },
      { label: 'Assign to vehicle', icon: <Link2 />, hidden: !e || r.vehicleId !== null || r.state === 'expired', separatorBefore: true, onClick: () => setDialog({ kind: 'assign', card: r }) },
      { label: 'Edit limit', icon: <Gauge />, hidden: !e, onClick: () => setDialog({ kind: 'limit', card: r }) },
      { label: 'Block card', icon: <Lock />, hidden: !e || r.state !== 'active', onClick: () => void blockCard(r) },
      { label: 'Unblock card', icon: <LockOpen />, hidden: !e || r.state !== 'blocked', onClick: () => unblockCard(r) },
      { label: 'Replace card', icon: <RefreshCw />, hidden: !e || !r.vehicleId || r.state === 'unassigned', onClick: () => void replaceCard(r) },
      { label: 'Unassign', icon: <Unlink />, hidden: !e || !r.vehicleId, onClick: () => void unassignCard(r) },
      { label: 'Delete card', icon: <Trash2 />, destructive: true, hidden: !perms.canDelete || r.state === 'active', separatorBefore: true, onClick: () => void retireCard([r]) },
    ]
  }

  const bulk: BulkAction<CardRow>[] = perms.canEdit
    ? [
        {
          label: 'Block',
          icon: <Lock />,
          onClick: async (sel, clear) => {
            const t = sel.filter((r) => r.state === 'active')
            if (!t.length) return toast.info('No active cards in the selection')
            if (!(await confirm({ title: `Block ${t.length} card${t.length === 1 ? '' : 's'}?`, description: 'Blocked cards are declined at every pump.', confirmLabel: 'Block', destructive: true }))) return
            useDb.getState().updateMany('fuelCards', t.map((r) => r.id), { status: 'blocked' }, { action: 'status', summary: `Blocked ${t.length} fuel cards` })
            toast.success(`${t.length} card${t.length === 1 ? '' : 's'} blocked`)
            clear()
          },
        },
        {
          label: 'Unblock',
          icon: <LockOpen />,
          onClick: (sel, clear) => {
            const t = sel.filter((r) => r.state === 'blocked')
            if (!t.length) return void toast.info('No blocked cards in the selection')
            useDb.getState().updateMany('fuelCards', t.map((r) => r.id), { status: 'active' }, { action: 'status', summary: `Unblocked ${t.length} fuel cards` })
            toast.success(`${t.length} card${t.length === 1 ? '' : 's'} unblocked`)
            clear()
          },
        },
      ]
    : []

  const dlg = dialog
  const card = dlg?.card

  return (
    <Page>
      <PageHeader
        title="Fuel cards"
        description="Card register, monthly limits and utilisation, spare cards and expiry alerts."
        actions={perms.canManage && <Button onClick={() => setDialog({ kind: 'issue' })}><Plus /> Issue card</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Cards issued" icon={CreditCard} value={data.length} />
        <KpiCard label="Active" value={stats.active} status="success" />
        <KpiCard label="Blocked" value={stats.blocked} status={stats.blocked ? 'warning' : undefined} />
        <KpiCard label="Expired" value={stats.expired} status={stats.expired ? 'danger' : undefined} />
        <KpiCard label="Spare cards" value={stats.spare} icon={ArrowRightLeft} />
        <KpiCard label="Spend vs limits" icon={Wallet} value={stats.limit ? (stats.spent / stats.limit) * 100 : 0} format={(n) => `${Math.round(n)}%`} hint={`${money(stats.spent)} of ${money(stats.limit)} monthly limits (active cards)`} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Alerts" description={`${alerts.length} card${alerts.length === 1 ? '' : 's'} need attention`} className="lg:col-span-2" flush>
          {alerts.length === 0 ? (
            <EmptyState compact icon={CreditCard} title="No card alerts" description="No cards are near their limit, expired or blocked." />
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <AlertTriangle className={cn('size-4 shrink-0', a.tone === 'danger' ? 'text-danger' : a.tone === 'warning' ? 'text-warning' : 'text-info')} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setOpenId(a.row.id)} className="truncate text-left text-[13px] font-medium hover:text-primary hover:underline">{a.title}</button>
                    <p className="truncate text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                  {a.run && perms.canEdit && <Button size="xs" variant="outline" onClick={a.run}>{a.label}</Button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Spare cards" description="Unassigned cards ready to issue" flush>
          {spare.length === 0 ? (
            <EmptyState compact icon={CreditCard} title="No spare cards" description="Issue a new card to build up a buffer." />
          ) : (
            <ul className="divide-y divide-border">
              {spare.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <CreditCard className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="num text-[13px] font-medium">{r.number}</div>
                    <p className="truncate text-xs text-muted-foreground">{r.provider} · {money(r.monthlyLimitUsd)} · exp {fmtDate(r.expiry, 'MMM yyyy')}</p>
                  </div>
                  {perms.canEdit && <Button size="xs" variant="outline" onClick={() => setDialog({ kind: 'assign', card: r })}>Assign</Button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-3">
        <DataTable
          tableId="fuel-cards"
          data={data}
          columns={columns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search card, vehicle, driver…"
          facets={[
            { columnId: 'status', label: 'Status', options: Object.values(STATE_META).map((m) => ({ value: m.label, label: m.label })) },
            { columnId: 'provider', label: 'Provider', options: PROVIDERS.map((p) => ({ value: p, label: p })) },
          ]}
          selectable={bulk.length > 0 || perms.canExport}
          bulkActions={bulk}
          exportName={perms.canExport ? 'fuel-cards' : undefined}
          defaultSort={[{ id: 'util', desc: true }]}
          defaultHidden={['provider']}
          onRowClick={(r) => setOpenId(r.id)}
          mobileCard={(r) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="num font-medium">{r.number}</span>
                <Badge tone={STATE_META[r.state].tone}>{STATE_META[r.state].label}</Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{r.vehicleId ? <Plate>{r.reg}</Plate> : 'Unassigned'} · {r.provider}</span>
                <span className="num">{money(r.spentThisMonthUsd)} / {money(r.monthlyLimitUsd)}</span>
              </div>
              {r.vehicleId && <UtilisationBar pct={r.utilPct} />}
            </div>
          )}
        />
      </div>

      <CardDrawer row={openRow} txRows={txRows} onClose={() => setOpenId(null)} actions={rowActions} money={money} />

      <FormDialog
        open={dlg?.kind === 'issue'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Issue fuel card"
        description="Registers a new card. Assign it to a vehicle now or keep it as a spare."
        schema={issueSchema}
        defaultValues={{ provider: PROVIDERS[0]!, monthlyLimitUsd: 1500, expiry: toInputDate(addMonths(new Date(), 36).toISOString()), vehicleId: '' }}
        submitLabel="Issue card"
        onSubmit={(v) => {
          const rec = useDb.getState().insert('fuelCards', { number: maskedNumber(), vehicleId: v.vehicleId || null, provider: v.provider, status: v.vehicleId ? 'active' : 'unassigned', monthlyLimitUsd: v.monthlyLimitUsd, spentThisMonthUsd: 0, expiry: fromInputDate(v.expiry), pinSetAt: new Date().toISOString() }, { summary: `Issued fuel card (${v.provider})` })
          toast.success(`Card ${rec.number} issued`, { description: v.vehicleId ? `Assigned to ${getById('vehicles', v.vehicleId)?.reg}` : 'Added to spare cards' })
        }}
      >
        {(form) => (
          <FormGrid>
            <SelectField form={form} name="provider" label="Provider" required options={PROVIDERS.map((p) => ({ value: p, label: p }))} />
            <NumberField form={form} name="monthlyLimitUsd" label="Monthly limit" required prefix="$" min={0} step="50" />
            <DateField form={form} name="expiry" label="Expiry date" required />
            <ComboField form={form} name="vehicleId" label="Assign to vehicle" options={vehicleOptions} placeholder="Keep as spare" clearable />
          </FormGrid>
        )}
      </FormDialog>

      <FormDialog
        open={dlg?.kind === 'assign'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Assign card ${card?.number ?? ''}`}
        description="Attach this card to a vehicle. The vehicle must not already hold an active card."
        schema={assignSchema}
        defaultValues={{ cardId: card?.id ?? '', vehicleId: '' }}
        submitLabel="Assign card"
        onSubmit={(v) => {
          if (!card) return
          const old = useDb.getState().fuelCards.filter((c) => c.vehicleId === v.vehicleId && c.id !== card.id)
          for (const o of old) useDb.getState().update('fuelCards', o.id, { vehicleId: null }, { silent: true })
          patchCard(card, { vehicleId: v.vehicleId, status: 'active' }, `Assigned fuel card ${card.number} to ${getById('vehicles', v.vehicleId)?.reg}`, 'assign')
          toast.success(`Card ${card.number} assigned to ${getById('vehicles', v.vehicleId)?.reg}`)
        }}
      >
        {(form) => <ComboField form={form} name="vehicleId" label="Vehicle" required options={vehicleOptions} placeholder="Select vehicle" hint="Vehicles whose card is blocked or expired can take a spare card." />}
      </FormDialog>

      <FormDialog
        open={dlg?.kind === 'limit'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Edit limit · ${card?.number ?? ''}`}
        description={card ? `${money(card.spentThisMonthUsd)} spent this month against a ${money(card.monthlyLimitUsd)} limit.` : undefined}
        schema={limitSchema}
        defaultValues={{ spent: card?.spentThisMonthUsd ?? 0, monthlyLimitUsd: card?.monthlyLimitUsd ?? 1000 }}
        submitLabel="Save limit"
        onSubmit={(v) => {
          if (!card) return
          patchCard(card, { monthlyLimitUsd: v.monthlyLimitUsd }, `Changed monthly limit of fuel card ${card.number} from $${card.monthlyLimitUsd} to $${v.monthlyLimitUsd}`)
          toast.success(`Limit updated to ${money(v.monthlyLimitUsd)}`)
        }}
      >
        {(form) => <NumberField form={form} name="monthlyLimitUsd" label="Monthly limit" required prefix="$" min={0} step="50" />}
      </FormDialog>
    </Page>
  )
}

function CardDrawer({ row, txRows, onClose, actions, money }: { row: CardRow | null; txRows: ReturnType<typeof useFuelRows>; onClose: () => void; actions: (r: CardRow) => { label: string; icon?: React.ReactNode; onClick: () => void; destructive?: boolean; hidden?: boolean }[]; money: ReturnType<typeof useMoney> }) {
  const recent = useMemo(() => (row ? txRows.filter((t) => t.cardId === row.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8) : []), [txRows, row])
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        {row && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2 pr-6">
                <SheetTitle className="num">{row.number}</SheetTitle>
                <Badge tone={STATE_META[row.state].tone}>{STATE_META[row.state].label}</Badge>
              </div>
              <SheetDescription>{row.provider}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Limit" value={money(row.monthlyLimitUsd)} />
                <Stat label="Spent" value={money(row.spentThisMonthUsd)} />
                <Stat label="Remaining" value={money(Math.max(0, row.monthlyLimitUsd - row.spentThisMonthUsd))} tone={row.utilPct >= 100 ? 'danger' : row.utilPct >= 85 ? 'warning' : undefined} />
              </div>
              {row.vehicleId && <UtilisationBar pct={row.utilPct} />}
              <DetailGrid
                items={[
                  { label: 'Vehicle', value: row.vehicleId ? <span className="flex items-center gap-2"><VehicleLink id={row.vehicleId} /><span className="text-xs text-subtle-foreground">{row.model}</span></span> : 'Unassigned' },
                  { label: 'Driver', value: <DriverLink id={row.driverId} avatar /> },
                  { label: 'Expiry', value: <span className="flex items-center gap-2">{fmtDate(row.expiry)} <ExpiryBadge iso={row.expiry} warnDays={45} showValid={false} /></span> },
                  { label: 'PIN set', value: `${fmtDate(row.pinSetAt)} (${timeAgo(row.pinSetAt)})` },
                  { label: 'Last used', value: row.lastUsed ? fmtDateTime(row.lastUsed) : 'No transactions' },
                  { label: 'Transactions', value: fmtNumber(row.fills) },
                ]}
              />
              <section>
                <h3 className="label-xs mb-2">Recent transactions</h3>
                {recent.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No transactions recorded on this card.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                    {recent.map((t) => (
                      <li key={t.id}>
                        <Link to={`/fuel/transactions?open=${t.id}`} className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-accent/50">
                          <span className="flex items-center gap-2"><span className="num font-medium">{t.ref}</span><span className="text-subtle-foreground">{fmtDateTime(t.date)}</span></span>
                          <span className="num text-muted-foreground">{fmtNumber(t.litres, 1)} L · {money(t.totalUsd, { digits: 2 })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </SheetBody>
            <SheetFooter>
              {actions(row).filter((a) => !a.hidden && a.label !== 'View details').map((a) => (
                <Button key={a.label} size="sm" variant={a.destructive ? 'destructive' : 'outline'} onClick={() => { a.onClick(); if (a.destructive) onClose() }}>
                  {a.icon}
                  {a.label}
                </Button>
              ))}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, Copy, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Budget, ExpenseCategory } from '@/types'
import { useDb, db as getDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { useCan } from '@/hooks/useAuth'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { downloadObjectsCsv } from '@/lib/csv'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { FormDialog } from '@/components/forms/FormDialog'
import { NumberField, SelectField } from '@/components/forms/fields'
import { DataTable } from '@/components/data-table/DataTable'
import { ChartCard, BarList, TimeSeriesChart } from '@/components/charts/charts'
import { KpiCard } from '@/components/shared/KpiCard'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { useCosts } from './hooks'
import { COST_CATEGORIES, COST_COLOR, COST_LABEL, budgetLines, elapsedFraction, monthOf, periodLabel, shiftPeriod, type BudgetLine, type CostCategory, type CostEntry } from './lib'
import { VarianceText } from './ui'

const STATE_META = {
  over: { label: 'Over budget', tone: 'danger' as const, bar: 'bg-danger' },
  at_risk: { label: 'At risk', tone: 'warning' as const, bar: 'bg-warning' },
  ok: { label: 'On track', tone: 'success' as const, bar: 'bg-success' },
  none: { label: 'No budget', tone: 'neutral' as const, bar: 'bg-border-strong' },
}

const budgetId = (period: string, cat: string, branchId: string) => (branchId === 'all' ? `bud-${period}-${cat}` : `bud-${period}-${cat}-${branchId}`)

function upsertBudget(period: string, category: CostCategory, branchId: string, amount: number, note: string) {
  const id = budgetId(period, category, branchId)
  const db = getDb()
  const existing = db.budgets.find((b) => b.id === id)
  if (existing) db.update('budgets', id, { budgetUsd: amount }, { summary: note })
  else db.insert('budgets', { id, period, category: category as ExpenseCategory, branchId, budgetUsd: amount } as Budget, { summary: note })
}

export default function BudgetsPage() {
  const money = useMoney()
  const range = useDateRange()
  const { branchId, branch } = useBranchScope()
  const budgets = useDb((s) => s.budgets)
  const canEdit = useCan('finance.edit')
  const canCreate = useCan('finance.create')
  const canDelete = useCan('finance.delete')
  const canExport = useCan('finance.export')
  const { all, scoped, lookup } = useCosts()
  const [period, setPeriod] = useState(() => monthOf(range.to))
  const [window, setWindow] = useState<'6' | '12'>('6')
  const [editing, setEditing] = useState<BudgetLine | null>(null)
  const [adding, setAdding] = useState(false)
  const [drill, setDrill] = useState<CostCategory | null>(null)

  const nowPeriod = monthOf(new Date())
  const periodOptions = useMemo(() => {
    const set = new Set<string>(budgets.map((b) => b.period))
    for (let i = -5; i <= 2; i++) set.add(shiftPeriod(nowPeriod, i))
    set.add(period)
    return [...set].sort()
  }, [budgets, nowPeriod, period])

  const { lines, missing, total, elapsed } = useMemo(() => budgetLines(budgets, lookup, period, branchId), [budgets, lookup, period, branchId])
  const isCurrent = period === nowPeriod

  const trend = useMemo(() => {
    const n = Number(window)
    const out = []
    for (let i = n - 1; i >= 0; i--) {
      const p = shiftPeriod(period, -i)
      const t = budgetLines(budgets, lookup, p, branchId).total
      out.push({ label: periodLabel(p, 'MMM'), title: periodLabel(p), budget: Math.round(t.budget) || null, actual: Math.round(t.actual) || null })
    }
    return out
  }, [budgets, lookup, period, branchId, window])

  const catChart = useMemo(() => lines.map((l) => ({ label: COST_LABEL[l.category], budget: Math.round(l.budget), actual: Math.round(l.actual) })), [lines])

  const prevHas = useMemo(() => budgetLines(budgets, lookup, shiftPeriod(period, -1), branchId).lines.filter((l) => l.source === 'company' || l.source === 'branch'), [budgets, lookup, period, branchId])
  const copyable = prevHas.filter((l) => !lines.some((x) => x.category === l.category && (x.source === 'company' || x.source === 'branch')))

  const scopeLabel = branch ? branch.name : 'All branches'
  const overCount = lines.filter((l) => l.state === 'over').length
  const atRisk = lines.filter((l) => l.state === 'at_risk').length

  const copyPrev = () => {
    for (const l of copyable) upsertBudget(period, l.category, branchId, l.budget, `Copied ${COST_LABEL[l.category]} budget into ${periodLabel(period)} (${money(l.budget)})`)
    toast.success(`Copied ${copyable.length} budget${copyable.length === 1 ? '' : 's'} from ${periodLabel(shiftPeriod(period, -1))}`)
  }
  const removeLine = async (l: BudgetLine) => {
    if (!l.budgetId) return
    const ok = await confirm({ title: `Remove ${COST_LABEL[l.category]} budget?`, description: `The ${periodLabel(period)} budget for ${scopeLabel} is deleted. Actual spend remains visible.`, confirmLabel: 'Remove', destructive: true })
    if (!ok) return
    getDb().remove('budgets', l.budgetId, { summary: `Removed ${COST_LABEL[l.category]} budget for ${periodLabel(period)}` })
    toast.success('Budget removed')
  }
  const exportCsv = () =>
    downloadObjectsCsv(`budget-vs-actual-${period}`, lines, {
      Category: (l) => COST_LABEL[l.category], 'Budget (USD)': (l) => Math.round(l.budget), 'Actual (USD)': (l) => Math.round(l.actual), 'Variance (USD)': (l) => Math.round(l.variance),
      'Variance %': (l) => (l.variancePct === null ? '' : l.variancePct.toFixed(1)), 'Forecast (USD)': (l) => (l.forecast === null ? '' : Math.round(l.forecast)), Status: (l) => STATE_META[l.state].label,
    })

  const idx = periodOptions.indexOf(period)

  return (
    <Page>
      <PageHeader
        title="Budgets"
        description={`Budget versus actual operating cost for ${scopeLabel.toLowerCase()}. Actuals come live from fuel, workshop and expense data; the month selector overrides the global date range.`}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Previous month" disabled={idx <= 0} onClick={() => setPeriod(periodOptions[idx - 1]!)}><ChevronLeft /></Button>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-40" aria-label="Budget month"><SelectValue /></SelectTrigger>
                <SelectContent>{periodOptions.map((p) => <SelectItem key={p} value={p}>{periodLabel(p)}{p === nowPeriod ? ' (current)' : ''}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="icon" aria-label="Next month" disabled={idx >= periodOptions.length - 1} onClick={() => setPeriod(periodOptions[idx + 1]!)}><ChevronRight /></Button>
            </div>
            {canExport && <Button variant="outline" onClick={exportCsv} disabled={!lines.length}><Download /> Export</Button>}
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Budget" value={total.budget} format={(n) => money(n, { compact: true })} hint={`${periodLabel(period)} · ${scopeLabel}`} />
        <KpiCard label={isCurrent ? 'Actual (month to date)' : 'Actual spend'} value={total.actual} format={(n) => money(n, { compact: true })} hint={isCurrent ? `${Math.round(elapsed * 100)}% of the month elapsed` : undefined} />
        <KpiCard label="Variance" value={total.budget ? `${total.variance > 0 ? '+' : '−'}${money(Math.abs(total.variance), { compact: true })}` : '—'} delta={total.variancePct !== null ? { pct: total.variancePct, goodWhen: 'down', label: 'vs budget' } : undefined} status={total.state === 'over' ? 'danger' : total.state === 'at_risk' ? 'warning' : undefined} />
        <KpiCard label={elapsed >= 1 ? 'Categories over budget' : 'Month-end forecast'} value={elapsed >= 1 ? `${overCount} of ${lines.length}` : total.forecast === null ? 'Too early' : money(total.forecast, { compact: true })} hint={elapsed < 1 ? 'Projected from the spend run-rate so far' : undefined} status={overCount ? 'danger' : atRisk ? 'warning' : undefined} />
      </div>

      <Panel
        title={`Budget vs actual — ${periodLabel(period)}`}
        description={`${scopeLabel}${isCurrent ? ' · month to date' : ''}`}
        flush
        className="mb-3"
        actions={
          <>
            {canEdit && copyable.length > 0 && <Button size="xs" variant="outline" onClick={copyPrev}><Copy /> Copy from {periodLabel(shiftPeriod(period, -1), 'MMM')}</Button>}
            {canCreate && missing.length > 0 && <Button size="xs" onClick={() => setAdding(true)}><Plus /> Add category</Button>}
          </>
        }
      >
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm font-medium">No budgets set for {periodLabel(period)}</p>
            <p className="max-w-sm text-xs text-muted-foreground">Copy last month&apos;s budgets or add category budgets to start tracking variance.</p>
            <div className="flex gap-2">
              {canEdit && copyable.length > 0 && <Button size="sm" variant="outline" onClick={copyPrev}><Copy /> Copy from previous month</Button>}
              {canCreate && missing.length > 0 && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add category budget</Button>}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
                <tr className="h-9 border-b border-border">
                  <th className="px-3.5 text-left font-medium">Category</th>
                  <th className="px-2 text-right font-medium">Budget</th>
                  <th className="px-2 text-right font-medium">Actual</th>
                  <th className="px-2 text-right font-medium">Variance</th>
                  <th className="w-56 px-3 text-left font-medium">Utilisation</th>
                  {elapsed < 1 && <th className="px-2 text-right font-medium">Forecast</th>}
                  <th className="px-2 text-left font-medium">Status</th>
                  <th className="w-20 px-3" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <BudgetRow key={l.category} line={l} elapsed={elapsed} showForecast={elapsed < 1} canEdit={canEdit} canDelete={canDelete} onEdit={() => setEditing(l)} onDrill={() => setDrill(l.category)} onRemove={() => void removeLine(l)} money={money} />
                ))}
              </tbody>
              <tfoot>
                <tr className="h-10 border-t border-border-strong bg-surface-2/60 font-semibold">
                  <td className="px-3.5">Total</td>
                  <td className="num px-2 text-right">{money(total.budget)}</td>
                  <td className="num px-2 text-right">{money(total.actual)}</td>
                  <td className="px-2 text-right"><VarianceText value={total.variance} format={(n) => money(n)} /></td>
                  <td className="px-3"><span className="num text-xs text-muted-foreground">{total.usedPct === null ? '—' : `${total.usedPct.toFixed(0)}% used`}</span></td>
                  {elapsed < 1 && <td className="num px-2 text-right">{total.forecast === null ? '—' : money(total.forecast)}</td>}
                  <td className="px-2"><Badge tone={STATE_META[total.state].tone}>{STATE_META[total.state].label}</Badge></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard title="Budget vs actual by category" description={periodLabel(period)}>
          <TimeSeriesChart
            data={catChart}
            height={250}
            yFormat={(v) => money(v, { compact: true })}
            series={[
              { key: 'budget', label: 'Budget', type: 'bar', color: 'var(--chart-2)', format: (v) => money(v) },
              { key: 'actual', label: 'Actual', type: 'bar', color: 'var(--chart-1)', format: (v) => money(v) },
            ]}
            empty="Set budgets to compare"
          />
        </ChartCard>
        <ChartCard
          title="Budget trend"
          description="Total budget vs actual per month"
          actions={<Segmented size="xs" aria-label="Trend window" value={window} onChange={setWindow} options={[{ value: '6', label: '6M' }, { value: '12', label: '12M' }]} />}
        >
          <TimeSeriesChart
            data={trend}
            titleKey="title"
            height={250}
            yFormat={(v) => money(v, { compact: true })}
            series={[
              { key: 'actual', label: 'Actual', type: 'bar', color: 'var(--chart-1)', format: (v) => money(v) },
              { key: 'budget', label: 'Budget', type: 'line', color: 'var(--chart-3)', dashed: true, format: (v) => money(v) },
            ]}
          />
        </ChartCard>
      </div>

      <EditBudgetDialog line={editing} period={period} branchId={branchId} scopeLabel={scopeLabel} onClose={() => setEditing(null)} />
      <AddBudgetDialog open={adding} onOpenChange={setAdding} missing={missing} period={period} branchId={branchId} scopeLabel={scopeLabel} />
      <CategoryDrawer category={drill} period={period} entries={scoped} all={all} branchId={branchId} onClose={() => setDrill(null)} />
    </Page>
  )
}

function BudgetRow({ line: l, elapsed, showForecast, canEdit, canDelete, onEdit, onDrill, onRemove, money }: {
  line: BudgetLine; elapsed: number; showForecast: boolean; canEdit: boolean; canDelete: boolean; onEdit: () => void; onDrill: () => void; onRemove: () => void; money: ReturnType<typeof useMoney>
}) {
  const meta = STATE_META[l.state]
  const used = l.usedPct ?? 0
  const explicit = l.source === 'company' || l.source === 'branch'
  return (
    <tr className="h-11 border-b border-border/70 transition-colors last:border-0 hover:bg-accent/30">
      <td className="px-3.5">
        <span className="inline-flex items-center gap-2 font-medium"><span className="size-2 rounded-[3px]" style={{ background: COST_COLOR[l.category] }} />{COST_LABEL[l.category]}</span>
        {l.source === 'allocated' && <span className="ml-2 text-[11px] text-subtle-foreground">allocated share</span>}
      </td>
      <td className="num px-2 text-right">
        {l.budget ? money(l.budget) : <span className="text-subtle-foreground">—</span>}
      </td>
      <td className="px-2 text-right">
        <button type="button" onClick={onDrill} className="num rounded px-1 underline-offset-2 hover:text-primary hover:underline" aria-label={`View ${COST_LABEL[l.category]} spend`}>{money(l.actual)}</button>
      </td>
      <td className="px-2 text-right">{l.budget ? <span className="inline-flex flex-col items-end leading-tight"><VarianceText value={l.variance} format={(n) => money(n)} /><span className="num text-[11px] text-subtle-foreground">{l.variancePct === null ? '' : `${l.variancePct > 0 ? '+' : ''}${l.variancePct.toFixed(1)}%`}</span></span> : <span className="text-subtle-foreground">—</span>}</td>
      <td className="px-3">
        {l.budget ? (
          <div className="flex items-center gap-2">
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label={`${COST_LABEL[l.category]} budget used`}>
              <div className={cn('h-full rounded-full transition-[width] duration-500', meta.bar)} style={{ width: `${Math.min(100, used)}%` }} />
              {elapsed > 0 && elapsed < 1 && <span className="absolute top-0 h-full w-px bg-foreground/60" style={{ left: `${elapsed * 100}%` }} title={`Month ${Math.round(elapsed * 100)}% elapsed`} />}
            </div>
            <span className={cn('num w-10 text-right text-xs', used > 100 ? 'font-medium text-danger' : 'text-muted-foreground')}>{used.toFixed(0)}%</span>
          </div>
        ) : (
          <span className="text-xs text-subtle-foreground">Spend without a budget</span>
        )}
      </td>
      {showForecast && <td className="num px-2 text-right text-muted-foreground">{l.forecast === null ? '—' : money(l.forecast)}</td>}
      <td className="px-2"><Badge tone={meta.tone}>{meta.label}</Badge></td>
      <td className="px-3 text-right">
        <span className="inline-flex gap-0.5">
          {canEdit && <Button variant="ghost" size="icon-sm" aria-label={`Edit ${COST_LABEL[l.category]} budget`} onClick={onEdit}><Pencil /></Button>}
          {canDelete && explicit && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${COST_LABEL[l.category]} budget`} onClick={onRemove}><Trash2 /></Button>}
        </span>
      </td>
    </tr>
  )
}

function EditBudgetDialog({ line, period, branchId, scopeLabel, onClose }: { line: BudgetLine | null; period: string; branchId: string; scopeLabel: string; onClose: () => void }) {
  const money = useMoney()
  const { lookup } = useCosts()
  const schema = useMemo(() => z.object({ amountUsd: z.number({ error: 'Enter the budget amount' }).min(0, 'Budget cannot be negative').max(10_000_000, 'Amount looks too large') }), [])
  const prev = line ? [1, 2, 3].map((i) => lookup(shiftPeriod(period, -i), line.category, branchId)) : []
  const avg = prev.filter((x) => x > 0).reduce((s, x) => s + x, 0) / Math.max(1, prev.filter((x) => x > 0).length)
  return (
    <FormDialog
      open={!!line}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={line ? `${COST_LABEL[line.category]} budget` : 'Budget'}
      description={`${periodLabel(period)} · ${scopeLabel}`}
      schema={schema}
      defaultValues={{ amountUsd: line ? Math.round(line.budget) || Math.round(avg) : 0 }}
      onSubmit={(v) => {
        if (!line) return
        upsertBudget(period, line.category, branchId, Math.round(v.amountUsd), `Set ${COST_LABEL[line.category]} budget for ${periodLabel(period)} to ${money(v.amountUsd)}${branchId === 'all' ? '' : ` (${scopeLabel})`}`)
        toast.success(`${COST_LABEL[line.category]} budget updated`, { description: `${periodLabel(period)} · ${money(v.amountUsd)}` })
      }}
    >
      {(form) => (
        <>
          <NumberField form={form} name="amountUsd" label="Budget (USD)" required prefix="$" min={0} step={50} />
          {line && (
            <div className="space-y-1 rounded-md border border-border bg-surface-2/50 p-3 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Actual this month</span><span className="num text-foreground">{money(line.actual)}</span></div>
              <div className="flex justify-between"><span>3-month average</span><span className="num text-foreground">{money(avg)}</span></div>
              <Button type="button" size="xs" variant="outline" className="mt-1" onClick={() => form.setValue('amountUsd', Math.round(avg / 50) * 50, { shouldValidate: true })}>Use 3-month average</Button>
              {line.source === 'allocated' && <p className="pt-1 text-subtle-foreground">This is an allocated share of the company budget; saving creates a branch-specific budget.</p>}
            </div>
          )}
        </>
      )}
    </FormDialog>
  )
}

function AddBudgetDialog({ open, onOpenChange, missing, period, branchId, scopeLabel }: { open: boolean; onOpenChange: (o: boolean) => void; missing: CostCategory[]; period: string; branchId: string; scopeLabel: string }) {
  const money = useMoney()
  const schema = useMemo(() => z.object({ category: z.string().min(1, 'Select a category'), amountUsd: z.number({ error: 'Enter the budget amount' }).positive('Budget must be greater than zero').max(10_000_000) }), [])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Add category budget"
      description={`${periodLabel(period)} · ${scopeLabel}`}
      schema={schema}
      defaultValues={{ category: missing[0] ?? '', amountUsd: undefined as unknown as number }}
      submitLabel="Add budget"
      onSubmit={(v) => {
        upsertBudget(period, v.category as CostCategory, branchId, Math.round(v.amountUsd), `Added ${COST_LABEL[v.category as CostCategory]} budget for ${periodLabel(period)} (${money(v.amountUsd)})`)
        toast.success(`${COST_LABEL[v.category as CostCategory]} budget added`)
      }}
    >
      {(form) => (
        <>
          <SelectField form={form} name="category" label="Category" required options={missing.map((c) => ({ value: c, label: COST_LABEL[c] }))} />
          <NumberField form={form} name="amountUsd" label="Budget (USD)" required prefix="$" min={0} step={50} />
        </>
      )}
    </FormDialog>
  )
}

function CategoryDrawer({ category, period, entries, all, branchId, onClose }: { category: CostCategory | null; period: string; entries: CostEntry[]; all: CostEntry[]; branchId: string; onClose: () => void }) {
  const money = useMoney()
  const [last, setLast] = useState<CostCategory | null>(null)
  if (category && category !== last) setLast(category)
  const cat = category ?? last
  const items = useMemo(() => (cat ? (branchId === 'all' ? all : entries).filter((e) => e.category === cat && monthOf(e.ts) === period) : []), [cat, period, entries, all, branchId])
  const total = items.reduce((s, e) => s + e.amountUsd, 0)
  const topVehicles = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of items) if (e.vehicleId) m.set(e.vehicleId, (m.get(e.vehicleId) ?? 0) + e.amountUsd)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [items])
  const SRC = { fuel: 'Fuel purchase', workorder: 'Work order', expense: 'Expense' } as const
  const columns = useMemo<ColumnDef<CostEntry, any>[]>(
    () => [
      { id: 'date', accessorFn: (r) => r.ts, header: 'Date', size: 100, cell: ({ row }) => <span className="num">{fmtDate(row.original.ts)}</span>, meta: { exportValue: (r) => new Date(r.ts).toISOString().slice(0, 10) } },
      { id: 'source', accessorFn: (r) => SRC[r.source], header: 'Source', size: 112 },
      { id: 'ref', accessorFn: (r) => r.ref, header: 'Ref', size: 108, cell: ({ row }) => <EntityLink type={row.original.source === 'fuel' ? 'fuel' : row.original.source === 'workorder' ? 'workorder' : 'expense'} id={row.original.refId} /> },
      { id: 'detail', accessorFn: (r) => r.detail, header: 'Detail', size: 220 },
      { id: 'vehicle', accessorFn: (r) => r.vehicleId ?? '', header: 'Vehicle', size: 100, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'amount', accessorFn: (r) => r.amountUsd, header: 'Amount', size: 100, meta: { align: 'right', label: 'Amount (USD)' }, cell: ({ row }) => <span className="font-medium">{money(row.original.amountUsd, { digits: 2 })}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money],
  )
  return (
    <Sheet open={!!category} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <SheetHeader>
          <SheetTitle>{cat ? COST_LABEL[cat] : ''} spend — {periodLabel(period)}</SheetTitle>
          <SheetDescription>{items.length} transactions · {money(total, { digits: 2 })}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {topVehicles.length > 0 && (
            <Panel title="Largest vehicles">
              <BarList
                items={topVehicles.map(([id, v]) => ({ label: <VehicleLink id={id} />, value: v, color: cat ? COST_COLOR[cat] : undefined }))}
                format={(v) => money(v)}
              />
            </Panel>
          )}
          <DataTable<CostEntry>
            tableId="finance.budget.items"
            data={items}
            columns={columns}
            getRowId={(r) => r.key}
            exportName={`${cat ?? 'category'}-spend-${period}`}
            defaultSort={[{ id: 'amount', desc: true }]}
            defaultPageSize={10}
            pageSizes={[10, 25, 50]}
            searchPlaceholder="Search transactions…"
            emptyTitle="No transactions"
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

void COST_CATEGORIES
void elapsedFraction

import { useDeferredValue, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { format } from 'date-fns'
import { ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3, ChevronDown, FileSpreadsheet, Info, Lightbulb, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { RANGE_PRESETS, resolveRange, useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useCan } from '@/hooks/useAuth'
import { useDb } from '@/store/db'
import type { RangePreset } from '@/store/ui'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/menus'
import { EmptyState } from '@/components/shared/EmptyState'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { ReportChart } from './components/ReportCharts'
import { ReportTable } from './components/ReportTable'
import { ReportToolbar, useReportState } from './components/ReportToolbar'
import { CSV_UNIT, csvValue, useFormatter, type Formatter } from './components/useFormatter'
import { fmtWindow, makeDataset, makeWindow, SNAPSHOT_KEYS, type Snapshot } from './lib/common'
import { runReport } from './lib/engine'
import { useReportHistory } from './lib/history'
import { REPORT_BY_SLUG, REPORTS } from './lib/meta'
import { SPECS } from './lib/registry'
import type { ReportResult, ReportSpec, TableSpec } from './lib/types'
import './print.css'

export default function ReportPage() {
  const { category = '' } = useParams()
  const spec = SPECS[category]
  if (!spec) return <ReportNotFound slug={category} />
  return <ReportView key={category} spec={spec} />
}

function ReportNotFound({ slug }: { slug: string }) {
  return (
    <Page>
      <div className="panel">
        <EmptyState
          icon={BarChart3}
          title="Report not found"
          description={`There is no report called “${slug}”. Pick one from the report centre.`}
          action={<Button asChild><Link to="/reports">Back to report centre</Link></Button>}
        />
      </div>
    </Page>
  )
}

const CARRY = ['range', 'from', 'to', 'branch', 'cmp', 'gran']

function ReportView({ spec }: { spec: ReportSpec }) {
  const meta = REPORT_BY_SLUG[spec.slug]!
  const fmt = useFormatter()
  const canExport = useCan('reports.export')
  const { state, set, reset, dirty, search } = useReportState(spec)
  const globalRange = useDateRange()
  const { branchId: globalBranch } = useBranchScope()
  const branches = useDb((s) => s.branches)
  const logExport = useReportHistory((s) => s.logExport)
  const markRun = useReportHistory((s) => s.markRun)
  const snapshot = useDb(useShallow((s) => Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, s[k]])) as unknown as Snapshot))
  const snap = useDeferredValue(snapshot)

  const branchId = state.branch === 'global' ? globalBranch : state.branch
  const branchName = branchId === 'all' ? 'All depots' : (branches.find((b) => b.id === branchId)?.name ?? branchId)
  const globalBranchName = globalBranch === 'all' ? 'All depots' : (branches.find((b) => b.id === globalBranch)?.name ?? globalBranch)

  const window = useMemo(() => {
    if (state.range === 'global') return makeWindow(globalRange.from, globalRange.to, globalRange.label)
    const r = resolveRange(state.range as RangePreset, state.from, state.to, new Date(Math.floor(Date.now() / 6e4) * 6e4))
    const label = state.range === 'custom' ? fmtWindow({ from: r.from.getTime(), to: r.to.getTime() }) : (RANGE_PRESETS.find((p) => p.value === state.range)?.label ?? state.range)
    return makeWindow(r.from, r.to, label)
  }, [state.range, state.from, state.to, globalRange])

  const toggles = useMemo(() => Object.fromEntries((spec.toggles ?? []).map((t) => [t.key, !state.off.includes(t.key)])), [spec, state.off])
  const ds = useMemo(() => makeDataset(snap, branchId, Math.floor(Date.now() / 6e4) * 6e4), [snap, branchId])
  const result = useMemo(() => runReport(spec, { ds, window, groupBy: state.group, metric: state.metric, gran: state.gran, toggles }), [spec, ds, window, state.group, state.metric, state.gran, toggles])
  const metricLabels = useMemo(() => Object.fromEntries(spec.metrics.map((m) => [m, spec.measures[m]?.label ?? m])), [spec])

  const periodText = fmtWindow(window)
  useEffect(() => {
    markRun(spec.slug, { at: new Date().toISOString(), period: window.label, search })
  }, [spec.slug, window.label, search, markRun])

  // print mode: lets print.css take over the app shell
  useEffect(() => {
    document.documentElement.classList.add('fc-report')
    return () => document.documentElement.classList.remove('fc-report')
  }, [])

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const fileBase = `${spec.slug}-${state.group}-${stamp}`

  const exportTable = () => {
    const t = result.table
    const headers = [t.groupLabel, ...t.columns.map((c) => (CSV_UNIT[c.kind] ? `${c.label} (${CSV_UNIT[c.kind]})` : c.label))]
    const rows = t.rows.map((r) => [r.label, ...t.columns.map((c) => csvValue(r.v[c.key]))])
    if (t.totals) rows.push(['Total', ...t.columns.map((c) => csvValue(t.totals![c.key]))])
    downloadCsv(fileBase, headers, rows)
    logExport({ slug: spec.slug, title: meta.title, kind: 'CSV', file: `${fileBase}.csv`, rows: t.rows.length, period: window.label, search })
    toast.success(`Exported ${t.rows.length} rows to ${fileBase}.csv`)
  }
  const exportSummary = () => {
    const rows: (string | number)[][] = [
      ['Report', meta.title, '', ''], ['Period', periodText, '', ''], ['Depot', branchName, '', ''], ['Grouped by', result.groupLabel, '', ''], ['Generated', new Date().toISOString(), '', ''],
    ]
    for (const k of result.kpis) rows.push(['KPI', k.label, csvValue(k.value), csvValue(k.prev)])
    for (const c of result.charts) if (c.type === 'trend') for (const d of c.data) for (const s of c.series) rows.push([`Trend: ${c.title}`, `${String(d.title)} – ${s.label}`, csvValue(d[s.key] as number | null), ''])
    const name = `${spec.slug}-summary-${stamp}`
    downloadCsv(name, ['Section', 'Item', 'Value', 'Previous period'], rows)
    logExport({ slug: spec.slug, title: meta.title, kind: 'CSV', file: `${name}.csv`, rows: rows.length, period: window.label, search })
    toast.success(`Exported summary to ${name}.csv`)
  }
  const print = () => {
    logExport({ slug: spec.slug, title: meta.title, kind: 'Print', file: 'Print / PDF', rows: result.table.rows.length, period: window.label, search })
    setTimeout(() => globalThis.print(), 50)
  }

  const insights = useMemo(() => deriveInsights(result, state.compare, fmt), [result, state.compare, fmt])
  const carry = new URLSearchParams(search)
  for (const k of [...carry.keys()]) if (!CARRY.includes(k)) carry.delete(k)
  const carryStr = carry.toString()

  return (
    <Page className="report-page">
      <PageHeader
        title={meta.title}
        description={meta.description}
        meta={<Badge tone="outline">{meta.group}</Badge>}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild className="print:hidden">
              <Link to="/reports"><ArrowLeft /> Report centre</Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={!canExport} title={canExport ? undefined : 'Your role cannot export reports'} className="print:hidden">
                  <FileSpreadsheet /> Export CSV <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                <DropdownMenuLabel>Export</DropdownMenuLabel>
                <DropdownMenuItem onSelect={exportTable}>
                  <span className="flex flex-col leading-tight"><span>Detail table</span><span className="text-[11px] text-subtle-foreground">{result.table.rows.length} rows grouped by {result.groupLabel.toLowerCase()}</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={exportSummary}>
                  <span className="flex flex-col leading-tight"><span>Summary &amp; trends</span><span className="text-[11px] text-subtle-foreground">KPIs with previous period, chart series</span></span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={print} className="print:hidden"><Printer /> Print / PDF</Button>
          </>
        }
        className="print:hidden"
      />

      <nav aria-label="Reports" className="no-scrollbar -mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 pb-1 print:hidden sm:mx-0 sm:px-0">
        {REPORTS.map((r) => (
          <Link
            key={r.slug}
            to={`/reports/${r.slug}${carryStr ? `?${carryStr}` : ''}`}
            aria-current={r.slug === spec.slug ? 'page' : undefined}
            className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', r.slug === spec.slug ? 'border-primary/40 bg-primary/12 text-primary' : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground')}
          >
            <r.icon className="size-3.5" />
            {r.short}
          </Link>
        ))}
      </nav>

      {/* print-only report header */}
      <div className="mb-3 hidden border-b border-black/30 pb-2 print:block">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[16px] font-bold">{meta.title}</h1>
          <span className="text-[9px]">FleetCore · generated {format(new Date(), 'd MMM yyyy, HH:mm')}</span>
        </div>
        <p className="text-[9px]">Period: {periodText} ({window.days} days) · Depot: {branchName} · Grouped by: {result.groupLabel} · Metric: {result.metricLabel}</p>
      </div>

      <div className="space-y-3">
        <ReportToolbar spec={spec} state={state} set={set} reset={reset} dirty={dirty} windowLabel={window.label} globalLabel={globalRange.label} globalBranch={globalBranchName} metricLabels={metricLabels} />

        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground print:hidden">
          <span className="num font-medium text-foreground">{periodText}</span> · {window.days} day{window.days === 1 ? '' : 's'} · {branchName} · grouped by {result.groupLabel.toLowerCase()} · {result.factCount.toLocaleString()} data points
        </p>

        {result.factCount === 0 ? (
          <div className="panel">
            <EmptyState icon={BarChart3} title="No data in this period" description="There are no records for this report in the selected period and depot. Widen the date range or switch depot." />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {result.kpis.map((k) => {
                const num = typeof k.value === 'number'
                const parts = fmt.parts(k.kind, k.value, true)
                return (
                  <KpiCard
                    key={k.key}
                    label={k.label}
                    icon={k.icon}
                    value={k.value === null ? '—' : num ? (k.value as number) : String(k.value)}
                    format={num ? (n) => fmt.parts(k.kind, n, true).text : undefined}
                    unit={num ? parts.unit : undefined}
                    delta={state.compare && num && typeof k.prev === 'number' && k.prev !== 0 ? { pct: pctChange(k.value as number, k.prev), goodWhen: k.goodWhen } : undefined}
                    spark={k.spark}
                    hint={k.hint ? <span className="block max-w-56 text-xs">{k.hint}{typeof k.prev === 'number' ? <span className="mt-1 block text-subtle-foreground">Previous period: {fmt(k.kind, k.prev)}</span> : null}</span> : undefined}
                  />
                )
              })}
            </div>

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {result.charts.map((c) => <ReportChart key={c.id} spec={c} />)}
            </div>

            {insights.length > 0 && (
              <Panel title="Key findings" description="Generated from the figures above" className="break-inside-avoid">
                <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-4">
                  {insights.map((i, n) => (
                    <li key={n} className="flex gap-2 text-[13px] leading-snug">
                      {i.tone === 'good' ? <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-success" /> : i.tone === 'bad' ? <ArrowDownRight className="mt-0.5 size-4 shrink-0 text-danger" /> : <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />}
                      <span>{i.text}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <section aria-label="Report data" className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 print:hidden">
                <h2 className="text-[13px] font-semibold">{result.table.title}</h2>
                <span className="text-xs text-muted-foreground">{result.table.rows.length} row{result.table.rows.length === 1 ? '' : 's'} · click a row to open it · click headers to sort</span>
              </div>
              <ReportTable key={`${spec.slug}-${state.group}-${state.metric}`} table={result.table} tableId={`report.${spec.slug}.${state.group}`} exportName={fileBase.replace(/-\d{4}-\d{2}-\d{2}$/, '')} canExport={canExport} />
            </section>

            {result.details.map((t: TableSpec) => (
              <section key={t.id} aria-label={t.title} className="space-y-2">
                <div className="print:hidden">
                  <h2 className="text-[13px] font-semibold">{t.title}</h2>
                  {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                </div>
                <ReportTable table={t} tableId={`report.${spec.slug}.${t.id}`} exportName={`${spec.slug}-${t.id}`} canExport={canExport} />
              </section>
            ))}
          </>
        )}

        <Panel title={<span className="flex items-center gap-1.5"><Info className="size-3.5 text-muted-foreground" /> About this report</span>} className="break-inside-avoid">
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {spec.definitions.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </Panel>
      </div>
    </Page>
  )
}

interface Insight {
  tone: 'good' | 'bad' | 'info'
  text: string
}

function deriveInsights(result: ReportResult, compare: boolean, fmt: Formatter): Insight[] {
  const out: Insight[] = []
  if (compare) {
    const movers = result.kpis
      .filter((k): k is typeof k & { value: number; prev: number } => typeof k.value === 'number' && typeof k.prev === 'number' && k.prev !== 0 && !!k.goodWhen)
      .map((k) => {
        const pct = ((k.value - k.prev) / Math.abs(k.prev)) * 100
        const good = k.goodWhen === 'down' ? pct < 0 : pct > 0
        return { k, pct, good }
      })
      .filter((m) => Math.abs(m.pct) >= 2)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    const best = movers.find((m) => m.good)
    const worst = movers.find((m) => !m.good)
    if (best) out.push({ tone: 'good', text: `${best.k.label} ${best.pct > 0 ? 'rose' : 'fell'} ${Math.abs(best.pct).toFixed(1)}% to ${fmt(best.k.kind, best.k.value)} versus the previous period.` })
    if (worst) out.push({ tone: 'bad', text: `${worst.k.label} ${worst.pct > 0 ? 'rose' : 'fell'} ${Math.abs(worst.pct).toFixed(1)}% to ${fmt(worst.k.kind, worst.k.value)} versus the previous period.` })
  }
  const rank = result.charts.find((c): c is Extract<typeof c, { type: 'ranking' }> => c.type === 'ranking' && !c.fixedOrder)
  if (rank && rank.items.length > 1) {
    const top = rank.items[0]!
    const bottom = rank.items[rank.items.length - 1]!
    const additive = ['usd', 'int', 'km', 'litres', 'hours'].includes(rank.kind)
    const total = rank.items.reduce((s, i) => s + Math.max(0, i.value), 0)
    out.push({ tone: 'info', text: `${top.label} leads on ${rank.metricLabel.toLowerCase()} at ${fmt(rank.kind, top.value)}${additive && total > 0 ? ` (${Math.round((top.value / total) * 100)}% of the total)` : ''}.` })
    out.push({ tone: 'info', text: `${bottom.label} is lowest at ${fmt(rank.kind, bottom.value)}.` })
  }
  const share = result.charts.find((c): c is Extract<typeof c, { type: 'share' }> => c.type === 'share')
  if (share && share.data.length > 1) {
    const total = share.data.reduce((s, d) => s + d.value, 0)
    const top = [...share.data].sort((a, b) => b.value - a.value)[0]!
    if (total > 0) out.push({ tone: 'info', text: `${top.name} is the largest slice of “${share.title.toLowerCase()}” at ${Math.round((top.value / total) * 100)}%.` })
  }
  return out.slice(0, 4)
}

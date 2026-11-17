import { useDeferredValue, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRight, Building2, CalendarDays, Clock, Download, FileText, Printer, Trash2 } from 'lucide-react'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useCan } from '@/hooks/useAuth'
import { useDb } from '@/store/db'
import { timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { DeltaChip, pctChange } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { Sparkline } from '@/components/charts/charts'
import { useFormatter } from './components/useFormatter'
import { fmtWindow, makeDataset, makeWindow, SNAPSHOT_KEYS, type Snapshot } from './lib/common'
import { runReport } from './lib/engine'
import { useReportHistory } from './lib/history'
import { REPORT_GROUPS, REPORTS } from './lib/meta'
import { SPECS } from './lib/registry'
import type { KpiSpec, ReportMeta } from './lib/types'

export default function ReportCentrePage() {
  const range = useDateRange()
  const { branchId, branch } = useBranchScope()
  const canExport = useCan('reports.export')
  const snapshot = useDb(useShallow((s) => Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, s[k]])) as unknown as Snapshot))
  const snap = useDeferredValue(snapshot)
  const { exports, lastRun, clearExports } = useReportHistory()

  // headline figure for each report under the global filters
  const headlines = useMemo(() => {
    const window = makeWindow(range.from, range.to, range.label)
    const ds = makeDataset(snap, branchId, Math.floor(Date.now() / 6e4) * 6e4)
    const out: Record<string, { kpi: KpiSpec; spark?: number[]; rows: number; empty: boolean }> = {}
    for (const r of REPORTS) {
      const spec = SPECS[r.slug]!
      const res = runReport(spec, { ds, window, groupBy: spec.defaultGroup, metric: spec.defaultMetric, gran: 'auto', toggles: Object.fromEntries((spec.toggles ?? []).map((t) => [t.key, t.default])) })
      const kpi = res.kpis[0]!
      out[r.slug] = { kpi, spark: res.kpis.find((k) => k.spark)?.spark, rows: res.table.rows.length, empty: res.factCount === 0 }
    }
    return out
  }, [snap, range, branchId])

  const metaOf = (slug: string) => REPORTS.find((r) => r.slug === slug)

  return (
    <Page>
      <PageHeader
        title="Reports & analytics"
        description="Ten ready-made reports computed live from fleet, trip, fuel, maintenance, safety and finance data. Every report honours the global period and depot, can be overridden locally, exported to CSV and printed."
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="outline" className="gap-1"><CalendarDays /> {range.label}</Badge>
            <Badge tone="outline" className="gap-1"><Building2 /> {branch?.name ?? 'All depots'}</Badge>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          {REPORT_GROUPS.map((g) => {
            const items = REPORTS.filter((r) => r.group === g)
            return (
              <section key={g} aria-label={g}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-[13px] font-semibold">{g}</h2>
                  <span className="text-xs text-subtle-foreground">{items.length} report{items.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {items.map((r) => <ReportCard key={r.slug} meta={r} head={headlines[r.slug]!} lastRun={lastRun[r.slug]} />)}
                </div>
              </section>
            )
          })}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-2 xl:self-start">
          <Panel
            title="Recent exports"
            description={canExport ? 'CSV downloads and prints from this browser' : 'Your role cannot export reports'}
            actions={exports.length > 0 ? <Button variant="ghost" size="xs" onClick={clearExports}><Trash2 /> Clear</Button> : undefined}
            flush
          >
            {exports.length === 0 ? (
              <EmptyState compact icon={Download} title="No exports yet" description="Open a report and use Export CSV or Print / PDF — your recent exports will be listed here." />
            ) : (
              <ul className="divide-y divide-border">
                {exports.map((e) => (
                  <li key={e.id}>
                    <Link to={`/reports/${e.slug}${e.search ? `?${e.search}` : ''}`} className="flex items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-accent/40">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted-foreground">
                        {e.kind === 'Print' ? <Printer className="size-3.5" /> : <FileText className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{metaOf(e.slug)?.title ?? e.title}</span>
                        <span className="block truncate text-[11px] text-subtle-foreground">{e.file}</span>
                        <span className="block text-[11px] text-muted-foreground">{e.kind} · {e.rows} rows · {e.period} · {timeAgo(e.at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="How reports work">
            <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
              <li>The headline figures use the top-bar period and depot: <span className="text-foreground">{fmtWindow({ from: range.from.getTime(), to: range.to.getTime() })}</span>.</li>
              <li>Inside a report you can override the period or depot, group the data differently, switch the ranking metric and compare with the previous period.</li>
              <li>Filters are kept in the page URL, so a report view can be bookmarked or shared.</li>
              <li>Print / PDF produces a clean landscape A4 layout with the full table.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </Page>
  )
}

function ReportCard({ meta, head, lastRun: lr }: { meta: ReportMeta; head: { kpi: KpiSpec; spark?: number[]; rows: number; empty: boolean }; lastRun?: { at: string; period: string; search: string } }) {
    const fmt = useFormatter()
    const k = head.kpi
    const num = typeof k.value === 'number'
    const parts = fmt.parts(k.kind, k.value, true)
    const to = `/reports/${meta.slug}${lr?.search ? `?${lr.search}` : ''}`
    return (
      <article className="panel group flex min-w-0 flex-col gap-3 p-3.5 transition-colors hover:border-border-strong">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"><meta.icon className="size-[18px]" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-tight"><Link to={`/reports/${meta.slug}`} className="hover:text-primary">{meta.title}</Link></h3>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{meta.description}</p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 rounded-md border border-border bg-surface-2/60 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] text-muted-foreground">{k.label}</div>
            {head.empty ? (
              <div className="text-[13px] text-subtle-foreground">No data in this period</div>
            ) : (
              <div className="flex items-baseline gap-1.5">
                <span className="num text-xl font-semibold leading-tight">{parts.text}</span>
                {parts.unit && <span className="text-xs text-muted-foreground">{parts.unit}</span>}
                {num && typeof k.prev === 'number' && k.prev !== 0 && <DeltaChip delta={{ pct: pctChange(k.value as number, k.prev), goodWhen: k.goodWhen }} />}
              </div>
            )}
          </div>
          {head.spark && head.spark.length > 1 && !head.empty && <Sparkline data={head.spark} className="w-24 shrink-0" height={30} />}
        </div>

        <ul className="flex flex-wrap gap-1.5">
          {meta.answers.map((a) => <li key={a} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted-foreground">{a}</li>)}
        </ul>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-subtle-foreground" title={lr ? `${lr.period}` : undefined}>
            <Clock className="size-3 shrink-0" />
            {lr ? `Last run ${timeAgo(lr.at)}` : 'Not run yet'}
          </span>
          <Button asChild size="sm" variant="soft">
            <Link to={to}>Open <ArrowRight /></Link>
          </Button>
        </div>
      </article>
    )
}

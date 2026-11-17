import type { LucideIcon } from 'lucide-react'
import type { EntityType } from '@/types'
import type { Granularity } from '@/lib/analytics'
import type { Tone } from '@/components/ui/display'
import type { StatusKind } from '@/config/status'
import type { Dataset } from './common'

/**
 * Report engine model.
 *
 * Every report is a *fact report*: a function turns the raw collections into additive "facts"
 * (`{ t, d: dimensions, m: measures }`). Everything shown on a report page — KPIs, trend charts, rankings,
 * the grouped table, totals, previous-period deltas — is derived from the same facts, so numbers always agree.
 */

export type ValueKind =
  | 'text' | 'int' | 'num1' | 'num2' | 'usd' | 'usd2' | 'pct' | 'pct1' | 'km' | 'litres' | 'hours' | 'minutes' | 'score' | 'date' | 'datetime'

export interface EntityRefLite {
  type: EntityType
  id: string
}

export interface Fact {
  /** timestamp (ms) used for time bucketing */
  t: number
  /** dimension values (ids / keys) */
  d: Record<string, string>
  /** additive measures */
  m: Record<string, number>
}

/** Aggregate of a set of facts. */
export interface Sums {
  n: number
  m: Record<string, number>
  sets: Record<string, Set<string>>
  facts: Fact[]
}

export interface DateWindow {
  from: number
  to: number
  prevFrom: number
  prevTo: number
  days: number
  label: string
}

export interface MeasureCtx {
  days: number
}

export interface Threshold {
  /** value at/above which the metric is "good" (below when `invert`) */
  good: number
  warn: number
  invert?: boolean
}

export interface MeasureDef {
  label: string
  kind: ValueKind
  fn: (s: Sums, x: MeasureCtx) => number | null
  goodWhen?: 'up' | 'down'
  hint?: string
  tone?: Threshold
}

export interface AttrDef {
  label: string
  kind: ValueKind
  /** value for a table row; null when not applicable */
  fn: (key: string, dim: string, x: { ds: Dataset; window: DateWindow; s: Sums }) => string | number | null
  dims?: string[]
  status?: StatusKind
  size?: number
  tone?: Threshold
}

export interface DimDef {
  value: string
  label: string
  resolve: (ds: Dataset, key: string) => { label: string; entity?: EntityRefLite; sub?: string }
}

export type ColRef = string | { key: string; size?: number; dims?: string[]; bar?: boolean; hideBelow?: 'sm' | 'md' | 'lg' | 'xl' }

export interface KpiDef {
  /** key of a measure; or provide `custom` */
  measure?: string
  key?: string
  label?: string
  kind?: ValueKind
  custom?: (x: { ds: Dataset; window: DateWindow; total: Sums }) => number | string | null
  goodWhen?: 'up' | 'down'
  hint?: string
  icon: LucideIcon
  spark?: boolean
}

export interface TrendSeriesDef {
  /** measure key; `$metric` = the metric chosen in the toolbar */
  measure: string
  label?: string
  type?: 'bar' | 'line' | 'area'
  axis?: 'left' | 'right'
  color?: string
  dashed?: boolean
}

export type ChartDef =
  | { id: string; type: 'trend'; title: string; description?: string; series: TrendSeriesDef[]; stacked?: boolean; span?: 1 | 2 | 3 }
  | { id: string; type: 'trendBy'; title: string; description?: string; dim: string; measure: string; limit?: number; span?: 1 | 2 | 3 }
  | { id: string; type: 'ranking'; title: string; description?: string; dim?: string; measure?: string; span?: 1 | 2 | 3; limit?: number }
  | { id: string; type: 'share'; title: string; description?: string; dim?: string; measure?: string; slices?: { measure: string; label: string; color?: string }[]; limit?: number; centerLabel?: string; span?: 1 | 2 | 3 }
  | { id: string; type: 'custom'; span?: 1 | 2 | 3; build: (x: RunCtx, c: Computed) => ChartSpec | null }

// ---------------------------------------------------------------------------
// Resolved chart specs (what the UI renders)
// ---------------------------------------------------------------------------
export interface TrendSeriesSpec {
  key: string
  label: string
  type: 'bar' | 'line' | 'area'
  axis: 'left' | 'right'
  color: string
  kind: ValueKind
  dashed?: boolean
}

export type ChartSpec =
  | { id: string; type: 'trend'; title: string; description?: string; span: 1 | 2 | 3; data: Record<string, unknown>[]; series: TrendSeriesSpec[]; stacked?: boolean }
  | { id: string; type: 'ranking'; title: string; description?: string; span: 1 | 2 | 3; items: RankingItem[]; kind: ValueKind; metricLabel: string; limit: number; goodWhen?: 'up' | 'down'; fixedOrder?: boolean }
  | { id: string; type: 'share'; title: string; description?: string; span: 1 | 2 | 3; data: { name: string; value: number; color?: string }[]; kind: ValueKind; centerLabel?: string }

export interface RankingItem {
  key: string
  label: string
  value: number
  sub?: string
  entity?: EntityRefLite
}

// ---------------------------------------------------------------------------
// Table / KPI output
// ---------------------------------------------------------------------------
export interface ColSpec {
  key: string
  label: string
  kind: ValueKind
  size?: number
  tone?: Threshold
  bar?: boolean
  status?: StatusKind
  hint?: string
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

export interface ReportRow {
  id: string
  label: string
  sortKey?: string
  entity?: EntityRefLite
  sub?: string
  v: Record<string, number | string | null>
}

export interface TableSpec {
  id: string
  title: string
  description?: string
  groupLabel: string
  columns: ColSpec[]
  rows: ReportRow[]
  totals?: Record<string, number | string | null> | null
  defaultSort?: { id: string; desc: boolean }
  /** rows can be clicked to open their entity */
  clickable?: boolean
}

export interface KpiSpec {
  key: string
  label: string
  kind: ValueKind
  value: number | string | null
  prev?: number | null
  goodWhen?: 'up' | 'down'
  hint?: string
  icon: LucideIcon
  spark?: number[]
  tone?: Tone
}

export interface ReportResult {
  kpis: KpiSpec[]
  charts: ChartSpec[]
  table: TableSpec
  details: TableSpec[]
  /** number of facts behind the report (0 = no data in the period) */
  factCount: number
  groupLabel: string
  metricLabel: string
  granularity: Granularity
}

// ---------------------------------------------------------------------------
// Report specification
// ---------------------------------------------------------------------------
export interface RunCtx {
  ds: Dataset
  window: DateWindow
  groupBy: string
  metric: string
  gran: Granularity | 'auto'
  toggles: Record<string, boolean>
}

export interface Computed {
  spec: ReportSpec
  buckets: import('@/lib/analytics').Bucket[]
  granularity: Granularity
  facts: Fact[]
  total: Sums
}

export interface ReportSpec {
  slug: string
  dims: DimDef[]
  defaultGroup: string
  /** dimension used by ranking/share charts when grouping by period */
  fallbackDim: string
  metrics: string[]
  defaultMetric: string
  toggles?: { key: string; label: string; default: boolean }[]
  measures: Record<string, MeasureDef>
  attrs?: Record<string, AttrDef>
  columns: ColRef[]
  kpis: KpiDef[]
  charts: ChartDef[]
  facts: (ds: Dataset, win: { from: number; to: number }, toggles: Record<string, boolean>) => Fact[]
  /** dimensions whose distinct values are counted (`distinct(s, dim)`) */
  distinct?: string[]
  details?: (x: RunCtx, c: Computed) => TableSpec[]
  /** plain-language definitions, shown under "About this report" and in print */
  definitions: string[]
  /** default table sort */
  sort?: (groupBy: string, metric: string) => { id: string; desc: boolean }
  /** hide table rows that have no activity */
  keepRow?: (s: Sums, key: string, groupBy: string) => boolean
}

export interface ReportMeta {
  slug: string
  title: string
  short: string
  description: string
  group: 'Operations' | 'Fleet' | 'Finance' | 'Safety & people'
  icon: LucideIcon
  /** what questions the report answers (shown on the centre card) */
  answers: string[]
}

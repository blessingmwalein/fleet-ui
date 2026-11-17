import { useMemo, useState } from 'react'
import { autoGranularity, makeBuckets, type Bucket, type Granularity } from '@/lib/analytics'
import type { SegmentOption } from '@/components/ui/segmented'
import { useDash } from './useDashboardScope'

/**
 * Day / week / month switch for a chart. Defaults to the auto granularity for the active date range and
 * disables buckets that would leave the chart with only one or two points.
 */
export function useGranularity() {
  const { trend } = useDash()
  const [choice, setChoice] = useState<Granularity | null>(null)
  const options: SegmentOption<Granularity>[] = useMemo(
    () => [
      { value: 'day', label: 'Day' },
      { value: 'week', label: 'Week', disabled: trend.days < 14 },
      { value: 'month', label: 'Month', disabled: trend.days < 56 },
    ],
    [trend.days],
  )
  const auto = autoGranularity(trend.days)
  const g: Granularity = choice && !options.find((o) => o.value === choice)?.disabled ? choice : auto
  const buckets: Bucket[] = useMemo(() => makeBuckets(trend.from, trend.to, g), [trend.from, trend.to, g])
  return { g, setG: setChoice, options, buckets }
}

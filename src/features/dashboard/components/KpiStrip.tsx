import { KpiCard } from '@/components/shared/KpiCard'
import { Skeleton } from '@/components/ui/form-controls'
import { useFleetLive } from '../hooks/useFleetLive'
import { useKpis } from '../hooks/useKpis'

export function KpiStrip({ loading }: { loading?: boolean }) {
  const live = useFleetLive()
  const kpis = useKpis(live)
  const busy = loading || !live.ready
  return (
    <section aria-label="Key performance indicators" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {busy
        ? Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
        : kpis.map((k) => (
            <KpiCard
              key={k.id}
              label={k.label}
              value={k.value}
              format={k.format}
              unit={k.unit}
              delta={k.delta}
              sub={k.sub}
              spark={k.spark}
              sparkColor={k.sparkColor}
              status={k.status}
              icon={k.icon}
              hint={k.hint}
              href={k.href}
            />
          ))}
    </section>
  )
}

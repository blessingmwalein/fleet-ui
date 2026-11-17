import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { LiveState } from '@/types'
import { useDb } from '@/store/db'
import { ROUTES } from '@/data/routes'
import { LIVE_STATE } from '@/config/status'
import { Panel } from '@/components/shared/Page'
import { Skeleton } from '@/components/ui/form-controls'
import { LIVE_ORDER, useFleetLive } from '../hooks/useFleetLive'
import { ViewAll } from './panel-kit'

// Equirectangular projection of Zimbabwe into a 400x360 schematic.
const LNG0 = 25.1
const LNG1 = 33.2
const LAT0 = -15.6
const LAT1 = -22.5
const W = 400
const H = 360
const px = (lng: number) => ((lng - LNG0) / (LNG1 - LNG0)) * W
const py = (lat: number) => ((LAT0 - lat) / (LAT0 - LAT1)) * H

let routePaths: string[] | null = null
/** Road network of the 21 corridors the fleet drives, thinned for a light SVG. */
function getRoutePaths() {
  if (routePaths) return routePaths
  routePaths = ROUTES.map((r) => {
    const step = Math.max(1, Math.ceil(r.coords.length / 70))
    const pts = r.coords.filter((_, i) => i % step === 0 || i === r.coords.length - 1)
    return pts.map(([lng, lat], i) => `${i ? 'L' : 'M'}${px(lng).toFixed(1)} ${py(lat).toFixed(1)}`).join('')
  })
  return routePaths
}

export function FleetMapCard() {
  const live = useFleetLive()
  const branches = useDb((s) => s.branches)

  const cities = useMemo(() => {
    const m = new Map<string, { city: string; lat: number; lng: number; vehicles: number; moving: number }>()
    for (const b of branches) if (b.type !== 'workshop' && !m.has(b.city)) m.set(b.city, { city: b.city, lat: b.lat, lng: b.lng, vehicles: 0, moving: 0 })
    for (const r of live.rows) {
      const b = branches.find((x) => x.id === r.vehicle.branchId)
      const c = b && m.get(b.city)
      if (c) {
        c.vehicles++
        if (r.state === 'moving') c.moving++
      }
    }
    return [...m.values()].sort((a, b) => b.vehicles - a.vehicles)
  }, [branches, live.rows])

  return (
    <Panel
      title="Fleet map"
      description={`${live.counts.moving} moving across ${ROUTES.length} corridors`}
      className="h-full"
      flush
      actions={<ViewAll to="/tracking">Live map</ViewAll>}
    >
      {!live.ready ? (
        <Skeleton className="m-3.5 h-64" />
      ) : (
        <div className="flex h-full flex-col">
          <Link to="/tracking" aria-label="Open live tracking map" className="relative block min-h-[230px] flex-1 overflow-hidden bg-surface-2/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full" role="img" aria-label="Schematic map of live vehicle positions">
              <defs>
                <pattern id="fm-grid" width="22" height="22" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.7" fill="var(--chart-grid)" />
                </pattern>
              </defs>
              <rect width={W} height={H} fill="url(#fm-grid)" />
              <g fill="none" stroke="var(--border-strong)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9">
                {getRoutePaths().map((d, i) => <path key={i} d={d} />)}
              </g>
              {cities.map((c) => (
                <g key={c.city} transform={`translate(${px(c.lng)} ${py(c.lat)})`}>
                  <rect x="-3.5" y="-3.5" width="7" height="7" rx="1.5" fill="var(--card)" stroke="var(--info)" strokeWidth="1.5" />
                  <text x="6" y="3" fontSize="9" fontWeight="500" fill="var(--muted-foreground)" style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 }}>{c.city}</text>
                </g>
              ))}
              {live.rows.map((r) => {
                if (!r.t) return null
                const s = r.state as LiveState
                const moving = s === 'moving'
                return (
                  <g key={r.vehicle.id} style={{ transform: `translate(${px(r.t.lng)}px, ${py(r.t.lat)}px)`, transition: 'transform 2s linear' }}>
                    {moving && <circle r="5.5" fill={LIVE_STATE[s].color} opacity="0.22" />}
                    <circle r={moving ? 2.8 : 2.2} fill={LIVE_STATE[s].color} stroke="var(--card)" strokeWidth="0.8" />
                  </g>
                )
              })}
            </svg>
            <div className="pointer-events-none absolute bottom-2 left-2.5 flex flex-wrap gap-x-2.5 gap-y-0.5 rounded-md bg-card/80 px-1.5 py-1 text-[10.5px] text-muted-foreground backdrop-blur-sm">
              {LIVE_ORDER.map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: LIVE_STATE[s].color }} />
                  {LIVE_STATE[s].label} <span className="num text-foreground">{live.counts[s]}</span>
                </span>
              ))}
            </div>
          </Link>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/70 px-3.5 py-2.5 text-xs">
            {cities.slice(0, 6).map((c) => (
              <div key={c.city} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">{c.city}</span>
                <span className="num font-medium">
                  {c.vehicles}
                  {c.moving > 0 && <span className="ml-1 text-success">· {c.moving} moving</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

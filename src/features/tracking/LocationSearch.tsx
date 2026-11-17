import * as React from 'react'
import { Building2, Globe, Landmark, Loader2, MapPin, Search, X, Fence } from 'lucide-react'
import { PLACES } from '@/data/places'
import { useDb } from '@/store/db'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/form-controls'

interface Hit {
  key: string
  label: string
  sub: string
  lat: number
  lng: number
  group: 'Places' | 'Depots' | 'Customers' | 'Geofences' | 'Online'
}

const ICONS = { Places: MapPin, Depots: Building2, Customers: Landmark, Geofences: Fence, Online: Globe }

/** Search places, depots, customer sites & geofences — falls back to OpenStreetMap Nominatim (Zimbabwe) for free text. */
export function LocationSearch({ onPick, onClear, active }: { onPick: (h: { lat: number; lng: number; label: string }) => void; onClear: () => void; active: boolean }) {
  const [q, setQ] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [online, setOnline] = React.useState<Hit[]>([])
  const [loading, setLoading] = React.useState(false)
  const branches = useDb((s) => s.branches)
  const customers = useDb((s) => s.customers)
  const geofences = useDb((s) => s.geofences)
  const wrap = React.useRef<HTMLDivElement>(null)

  const local = React.useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    const out: Hit[] = []
    for (const p of PLACES) if (p.name.toLowerCase().includes(s)) out.push({ key: `p-${p.name}`, label: p.name, sub: p.kind === 'suburb' ? 'Suburb' : p.kind === 'city' ? 'City' : 'Town', lat: p.lat, lng: p.lng, group: 'Places' })
    for (const b of branches) if (`${b.name} ${b.city}`.toLowerCase().includes(s)) out.push({ key: `b-${b.id}`, label: b.name, sub: b.address, lat: b.lat, lng: b.lng, group: 'Depots' })
    for (const c of customers) if (`${c.name} ${c.city}`.toLowerCase().includes(s)) out.push({ key: `c-${c.id}`, label: c.name, sub: c.address, lat: c.lat, lng: c.lng, group: 'Customers' })
    for (const g of geofences) if (g.name.toLowerCase().includes(s)) out.push({ key: `g-${g.id}`, label: g.name, sub: `${g.kind} geofence · ${g.radiusM} m`, lat: g.lat, lng: g.lng, group: 'Geofences' })
    return out.slice(0, 8)
  }, [q, branches, customers, geofences])

  // free-text address search (debounced) when local results are thin
  React.useEffect(() => {
    const s = q.trim()
    setOnline([])
    if (s.length < 3 || local.length >= 3) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=zw&limit=5&q=${encodeURIComponent(s)}`, { signal: ctl.signal, headers: { Accept: 'application/json' } })
        const json = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string; name?: string }[]
        setOnline(json.map((j) => ({ key: `o-${j.place_id}`, label: j.name || j.display_name.split(',')[0]!, sub: j.display_name, lat: Number(j.lat), lng: Number(j.lon), group: 'Online' })))
      } catch {
        /* offline or aborted */
      } finally {
        setLoading(false)
      }
    }, 450)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q, local.length])

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const hits = [...local, ...online]
  const pick = (h: Hit) => {
    setQ(h.label)
    setOpen(false)
    onPick({ lat: h.lat, lng: h.lng, label: h.label })
  }

  return (
    <div ref={wrap} className="pointer-events-auto relative w-[min(22rem,calc(100vw-5rem))]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) pick(hits[0])
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search a place, depot or address…"
          className="h-9 border-border bg-card/95 pl-8 pr-8 shadow-pop backdrop-blur"
          aria-label="Search locations"
        />
        {(q || active) && (
          <button type="button" onClick={() => { setQ(''); setOnline([]); onClear() }} className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground" aria-label="Clear location search">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          </button>
        )}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-pop">
          {hits.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">{loading ? 'Searching…' : 'No matching locations'}</div>
          ) : (
            hits.map((h) => {
              const Icon = ICONS[h.group]
              return (
                <button key={h.key} type="button" onClick={() => pick(h)} className={cn('flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent')}>
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{h.label}</span>
                    <span className="block truncate text-[11px] text-subtle-foreground">{h.sub}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-subtle-foreground">{h.group}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

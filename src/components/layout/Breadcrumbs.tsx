import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { FLAT_NAV, NAV } from '@/config/navigation'
import { useDb } from '@/store/db'
import { titleCase } from '@/lib/format'

type DbSnapshot = ReturnType<typeof useDb.getState>
const ENTITY_SEGMENTS: Partial<Record<string, (s: DbSnapshot, id: string) => string | undefined>> = {
  vehicles: (s, id) => s.vehicles.find((x) => x.id === id)?.reg,
  drivers: (s, id) => s.drivers.find((x) => x.id === id)?.name,
  shipments: (s, id) => s.shipments.find((x) => x.id === id)?.trackingRef,
  customers: (s, id) => s.customers.find((x) => x.id === id)?.name,
}

/** Label for the first URL segment: a leaf's label, or the submenu group that owns the segment. */
function rootLabel(seg: string): string {
  const leaf = FLAT_NAV.find((n) => n.to.split('?')[0] === `/${seg}` && !n.parent)
  if (leaf) return leaf.label
  for (const g of NAV) for (const it of g.items) if (it.children?.some((c) => c.to.split('/')[1] === seg)) return it.label
  return titleCase(seg)
}

/** Derives the trail from the URL and the nav config; detail ids resolve to record names. */
export function Breadcrumbs() {
  const { pathname } = useLocation()
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 0) return null
  const crumbs: { label: string; to: string }[] = []
  let acc = ''
  segs.forEach((seg, i) => {
    acc += `/${seg}`
    if (i === 0) {
      crumbs.push({ label: rootLabel(seg), to: acc })
      return
    }
    const nav = FLAT_NAV.find((n) => n.to.split('?')[0] === acc)
    const resolver = ENTITY_SEGMENTS[segs[i - 1]!]
    const label = nav?.label ?? (resolver && /-\d+$/.test(seg) ? resolver(useDb.getState(), seg) : undefined) ?? titleCase(seg)
    crumbs.push({ label, to: acc })
  })
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Link to="/dashboard" className="flex items-center transition-colors hover:text-foreground" aria-label="Home"><Home className="size-3.5" /></Link>
      {crumbs.map((c, i) => (
        <span key={c.to + i} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0 text-subtle-foreground" />
          {i === crumbs.length - 1 ? <span aria-current="page" className="truncate font-medium text-foreground">{c.label}</span> : <Link to={c.to} className="truncate transition-colors hover:text-foreground">{c.label}</Link>}
        </span>
      ))}
    </nav>
  )
}

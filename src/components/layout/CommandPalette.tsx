import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Building2, FileText, Fuel, Moon, Package, Route as RouteIcon, Search, ShieldAlert, Sun, SunMoon, UserRound, Wrench } from 'lucide-react'
import { FLAT_NAV, QUICK_CREATE } from '@/config/navigation'
import { useCurrentUser } from '@/hooks/useAuth'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { navigateTo, openEntity } from '@/lib/navigation'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays'
import { CommandEmpty, CommandGroup, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { CategoryIcon } from '@/components/shared/Status'
import type { EntityType } from '@/types'

interface Hit {
  key: string
  type: EntityType
  id: string
  title: string
  sub: string
  icon: React.ReactNode
  /** searchable haystack */
  hay: string
}

const MAX = 5

/** ⌘K / Ctrl+K — navigation, quick actions and cross-entity record search. */
export function CommandPalette() {
  const open = useUi((s) => s.commandOpen)
  const setOpen = useUi((s) => s.setCommandOpen)
  const setTheme = useUi((s) => s.setTheme)
  const { permissions } = useCurrentUser()
  const [query, setQuery] = React.useState('')
  const [deferred, setDeferred] = React.useState('')

  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const trips = useDb((s) => s.trips)
  const shipments = useDb((s) => s.shipments)
  const customers = useDb((s) => s.customers)
  const workOrders = useDb((s) => s.workOrders)
  const incidents = useDb((s) => s.incidents)
  const invoices = useDb((s) => s.invoices)
  const fuel = useDb((s) => s.fuelTransactions)

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!useUi.getState().commandOpen)
      }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target as HTMLElement)?.isContentEditable) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [setOpen])

  React.useEffect(() => {
    if (!open) { setQuery(''); setDeferred('') }
  }, [open])
  React.useEffect(() => {
    const t = setTimeout(() => setDeferred(query.trim().toLowerCase()), 120)
    return () => clearTimeout(t)
  }, [query])

  const index = React.useMemo<Hit[]>(() => {
    const ic = 'size-4'
    return [
      ...vehicles.map<Hit>((v) => ({ key: v.id, type: 'vehicle', id: v.id, title: v.reg, sub: `${v.make} ${v.model}`, icon: <CategoryIcon category={v.category} className={ic} />, hay: `${v.reg} ${v.make} ${v.model} ${v.vin} ${v.deviceId}`.toLowerCase() })),
      ...drivers.map<Hit>((d) => ({ key: d.id, type: 'driver', id: d.id, title: d.name, sub: `${d.empNo} · ${d.licenceNo}`, icon: <UserRound className={ic} />, hay: `${d.name} ${d.empNo} ${d.licenceNo} ${d.phone}`.toLowerCase() })),
      ...customers.map<Hit>((c) => ({ key: c.id, type: 'customer', id: c.id, title: c.name, sub: `${c.industry} · ${c.city}`, icon: <Building2 className={ic} />, hay: `${c.name} ${c.code} ${c.contactName} ${c.city}`.toLowerCase() })),
      ...shipments.map<Hit>((s) => ({ key: s.id, type: 'shipment', id: s.id, title: s.trackingRef, sub: `${s.cargoDescription} · ${s.pickup.city} → ${s.delivery.city}`, icon: <Package className={ic} />, hay: `${s.trackingRef} ${s.cargoDescription} ${s.pickup.name} ${s.delivery.name}`.toLowerCase() })),
      ...trips.map<Hit>((t) => ({ key: t.id, type: 'trip', id: t.id, title: t.ref, sub: `${t.origin.city} → ${t.destination.city} · ${t.cargoDescription}`, icon: <RouteIcon className={ic} />, hay: `${t.ref} ${t.origin.name} ${t.destination.name} ${t.cargoDescription}`.toLowerCase() })),
      ...workOrders.map<Hit>((w) => ({ key: w.id, type: 'workorder', id: w.id, title: w.woNo, sub: w.title, icon: <Wrench className={ic} />, hay: `${w.woNo} ${w.title}`.toLowerCase() })),
      ...incidents.map<Hit>((i) => ({ key: i.id, type: 'incident', id: i.id, title: i.ref, sub: `${i.type.replace('_', ' ')} · ${i.location}`, icon: <ShieldAlert className={ic} />, hay: `${i.ref} ${i.type} ${i.location} ${i.description}`.toLowerCase() })),
      ...invoices.map<Hit>((i) => ({ key: i.id, type: 'invoice', id: i.id, title: i.number, sub: i.partyName, icon: <FileText className={ic} />, hay: `${i.number} ${i.partyName}`.toLowerCase() })),
      ...fuel.map<Hit>((f) => ({ key: f.id, type: 'fuel', id: f.id, title: f.ref, sub: `${f.litres} L · ${f.receiptNo}`, icon: <Fuel className={ic} />, hay: `${f.ref} ${f.receiptNo}`.toLowerCase() })),
    ]
  }, [vehicles, drivers, trips, shipments, customers, workOrders, incidents, invoices, fuel])

  const groups = React.useMemo(() => {
    if (!deferred) return []
    const order: [EntityType, string][] = [['vehicle', 'Vehicles'], ['driver', 'Drivers'], ['trip', 'Trips'], ['shipment', 'Shipments'], ['customer', 'Customers'], ['workorder', 'Work orders'], ['incident', 'Incidents'], ['invoice', 'Invoices'], ['fuel', 'Fuel transactions']]
    return order.map(([type, label]) => ({ type, label, hits: index.filter((h) => h.type === type && h.hay.includes(deferred)).slice(0, MAX) })).filter((g) => g.hits.length)
  }, [deferred, index])

  const pages = FLAT_NAV.filter((n) => !n.permission || permissions.has(n.permission))
  const quick = QUICK_CREATE.filter((q) => permissions.has(q.permission))
  const match = (s: string) => !deferred || s.toLowerCase().includes(deferred)

  const go = (fn: () => void) => { setOpen(false); setTimeout(fn, 0) }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showClose={false} className="top-[18%] max-w-xl translate-y-0 overflow-hidden p-0" size="lg" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search pages, records and actions</DialogDescription>
        <CommandPrimitive shouldFilter={false} loop className="flex flex-col">
          <div className="flex h-11 items-center gap-2 border-b border-border px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input value={query} onValueChange={setQuery} placeholder="Search vehicles, drivers, trips, shipments… or jump to a page" className="h-full w-full bg-transparent text-[13.5px] outline-none placeholder:text-subtle-foreground" />
            <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
          </div>
          <CommandList className="max-h-[min(440px,60dvh)] p-1.5">
            <CommandEmpty>No results for “{query}”.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.type} heading={g.label}>
                {g.hits.map((h) => (
                  <CommandItem key={h.key} value={`${g.type}-${h.key}`} onSelect={() => go(() => openEntity({ type: h.type, id: h.id }))}>
                    {h.icon}
                    <span className="truncate font-medium">{h.title}</span>
                    <span className="ml-auto truncate pl-3 text-xs text-subtle-foreground">{h.sub}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {quick.some((q) => match(q.label)) && (
              <CommandGroup heading="Quick actions">
                {quick.filter((q) => match(q.label)).map((q) => (
                  <CommandItem key={q.to} value={`action-${q.label}`} onSelect={() => go(() => navigateTo(q.to))}>
                    <q.icon />
                    {q.label}
                    <span className="ml-auto text-xs text-subtle-foreground">{q.description}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {pages.some((p) => match(`${p.label} ${p.parent ?? ''} ${p.group}`)) && (
              <CommandGroup heading="Go to">
                {pages.filter((p) => match(`${p.label} ${p.parent ?? ''} ${p.group}`)).slice(0, deferred ? 12 : 8).map((p) => (
                  <CommandItem key={p.to} value={`page-${p.to}`} onSelect={() => go(() => navigateTo(p.to))}>
                    <p.icon />
                    {p.parent ? `${p.parent} · ${p.label}` : p.label}
                    <CommandShortcut>{p.group}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {match('theme dark light system appearance') && (
              <CommandGroup heading="Appearance">
                <CommandItem value="theme-dark" onSelect={() => go(() => setTheme('dark'))}><Moon /> Switch to dark theme</CommandItem>
                <CommandItem value="theme-light" onSelect={() => go(() => setTheme('light'))}><Sun /> Switch to light theme</CommandItem>
                <CommandItem value="theme-system" onSelect={() => go(() => setTheme('system'))}><SunMoon /> Use system theme</CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-subtle-foreground">
            <span>↑↓ navigate · ↵ open · esc close</span>
            <span className="hidden sm:inline">Tip: press <kbd className="rounded border border-border bg-surface-3 px-1">/</kbd> anywhere to search</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}


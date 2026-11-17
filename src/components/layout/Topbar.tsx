import * as React from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarDays, Check, Command, Menu, Moon, Plus, Search, Sun, SunMoon, Building2, Radio } from 'lucide-react'
import { QUICK_CREATE } from '@/config/navigation'
import { RANGE_PRESETS, useDateRange } from '@/hooks/useFilters'
import { useCurrentUser } from '@/hooks/useAuth'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { useUi, type RangePreset, type ThemeMode } from '@/store/ui'
import { navigateTo } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/form-controls'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlays'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { NotificationCenter } from './NotificationCenter'
import { UserMenuButton } from './UserMenu'

function SearchTrigger() {
  const setOpen = useUi((s) => s.setCommandOpen)
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-2/70 px-2.5 text-left text-[13px] text-subtle-foreground outline-none transition-colors hover:border-border-strong hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 sm:max-w-sm lg:max-w-md"
      aria-label="Search (Ctrl+K)"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="truncate">Search vehicles, drivers, trips…</span>
      <kbd className="ml-auto hidden shrink-0 items-center gap-0.5 rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
        <Command className="size-2.5" />K
      </kbd>
    </button>
  )
}

function DateRangePicker() {
  const range = useDateRange()
  const { rangePreset, customFrom, customTo, setRange } = useUi()
  const [open, setOpen] = React.useState(false)
  const [from, setFrom] = React.useState(customFrom || format(range.from, 'yyyy-MM-dd'))
  const [to, setTo] = React.useState(customTo || format(range.to, 'yyyy-MM-dd'))
  const pick = (p: RangePreset) => {
    if (p === 'custom') {
      setRange('custom', from, to)
    } else {
      setRange(p)
      setOpen(false)
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="default" className="gap-1.5 px-2.5" aria-label={`Date range: ${range.label}`}>
          <CalendarDays className="text-muted-foreground" />
          <span className="hidden max-w-[11rem] truncate sm:inline">{range.label}</span>
          <span className="sm:hidden">{RANGE_PRESETS.find((p) => p.value === rangePreset)?.short}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <div className="label-xs px-2 pb-1 pt-1.5">Date range</div>
        {RANGE_PRESETS.filter((p) => p.value !== 'custom').map((p) => (
          <button key={p.value} type="button" onClick={() => pick(p.value)} className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-accent focus-visible:bg-accent', rangePreset === p.value && 'text-primary')}>
            {p.label}
            {rangePreset === p.value && <Check className="size-3.5" />}
          </button>
        ))}
        <div className="mt-1 border-t border-border p-2">
          <div className="label-xs mb-1.5">Custom</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="dr-from" className="mb-1">From</Label><Input id="dr-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="dr-to" className="mb-1">To</Label><Input id="dr-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <Button size="sm" className="mt-2 w-full" disabled={!from || !to || from > to} onClick={() => { setRange('custom', from, to); setOpen(false) }}>Apply range</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function BranchSelector() {
  const branches = useDb((s) => s.branches)
  const branchId = useUi((s) => s.branchId)
  const setBranchId = useUi((s) => s.setBranchId)
  return (
    <Select value={branchId} onValueChange={setBranchId}>
      <SelectTrigger className="w-auto min-w-0 max-w-[14rem] gap-1.5 bg-transparent max-md:hidden" aria-label="Depot / branch">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="min-w-56">
        <SelectItem value="all">All depots</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ThemeSwitcher() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon
  return (
    <DropdownMenu>
      <Tooltip content="Theme"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Switch theme"><Icon /></Button></DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent className="w-40">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
          <DropdownMenuRadioItem value="light"><Sun className="size-4" /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="size-4" /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><SunMoon className="size-4" /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function QuickCreate() {
  const { permissions } = useCurrentUser()
  const items = QUICK_CREATE.filter((q) => permissions.has(q.permission))
  if (!items.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="default" className="gap-1 px-2.5 sm:px-3" aria-label="Quick create">
          <Plus /> <span className="hidden sm:inline">Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>Quick create</DropdownMenuLabel>
        {items.map((q) => (
          <DropdownMenuItem key={q.to} onSelect={() => navigateTo(q.to)}>
            <q.icon />
            <span className="flex flex-col leading-tight">
              <span>{q.label}</span>
              <span className="text-[11px] text-subtle-foreground">{q.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Small "demo" chip that makes clear the telemetry is simulated. */
function SimBadge() {
  const running = useLive((s) => s.running)
  const scale = useSettings((s) => s.simulation.timeScale)
  return (
    <Tooltip content={`Telemetry is simulated demo data${running ? ` (${scale}× speed)` : ' (paused)'}. Configure in Administration → Settings.`}>
      <Link to="/admin/settings" className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground xl:flex">
        <Radio className={cn('size-3', running ? 'text-primary' : 'text-subtle-foreground')} />
        Demo data · simulated GPS
      </Link>
    </Tooltip>
  )
}

export function Topbar() {
  const setMobileNav = useUi((s) => s.setMobileNavOpen)
  return (
    <header className="z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:px-3.5">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation">
        <Menu />
      </Button>
      <SearchTrigger />
      <div className="ml-auto flex items-center gap-1.5">
        <SimBadge />
        <DateRangePicker />
        <BranchSelector />
        <QuickCreate />
        <ThemeSwitcher />
        <NotificationCenter />
        <div className="ml-0.5 max-sm:hidden"><UserMenuButton /></div>
      </div>
    </header>
  )
}

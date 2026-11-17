import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV, type NavChild, type NavItem } from '@/config/navigation'
import { useCurrentUser } from '@/hooks/useAuth'
import { useNavBadges, type NavBadge } from '@/hooks/useNavBadges'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/display'
import { Tooltip } from '@/components/ui/overlays'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/menus'
import { Logo } from './Logo'
import { UserMenuItems } from './UserMenu'

const badgeCls: Record<NavBadge['tone'], string> = {
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
  success: 'bg-success/15 text-success',
}

function CountBadge({ b, className }: { b?: NavBadge; className?: string }) {
  if (!b) return null
  return <span className={cn('num ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-[10.5px] font-semibold leading-4', badgeCls[b.tone], className)}>{b.count}</span>
}

function activeChild(children: NavChild[], pathname: string): NavChild | undefined {
  let best: NavChild | undefined
  for (const c of children) {
    const base = c.to.split('?')[0]!
    if (pathname === base || pathname.startsWith(base + '/')) if (!best || base.length > best.to.length) best = c
  }
  return best
}

const itemBase = 'group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40'

function NavLeaf({ item, collapsed, badge, active, onNavigate }: { item: NavItem; collapsed: boolean; badge?: NavBadge; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  const link = (
    <Link to={item.to!} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn(itemBase, active ? 'bg-primary/10 text-foreground' : 'text-sidebar-foreground hover:bg-accent/60 hover:text-foreground', collapsed && 'justify-center px-0')}>
      {active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
      <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && <CountBadge b={badge} />}
      {collapsed && badge && <span className={cn('absolute right-1.5 top-1 size-1.5 rounded-full', badge.tone === 'danger' ? 'bg-danger' : badge.tone === 'warning' ? 'bg-warning' : 'bg-primary')} />}
    </Link>
  )
  return collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link
}

function NavGroupItem({ item, collapsed, badge, pathname, open, onToggle, onNavigate }: { item: NavItem; collapsed: boolean; badge?: NavBadge; pathname: string; open: boolean; onToggle: () => void; onNavigate?: () => void }) {
  const Icon = item.icon
  const children = item.children!
  const current = activeChild(children, pathname)
  const active = !!current

  if (collapsed) {
    return (
      <DropdownMenu>
        <Tooltip content={item.label} side="right">
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(itemBase, 'justify-center px-0', active ? 'bg-primary/10 text-foreground' : 'text-sidebar-foreground hover:bg-accent/60 hover:text-foreground')}>
              {active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
              <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} />
              {badge && <span className={cn('absolute right-1.5 top-1 size-1.5 rounded-full', badge.tone === 'danger' ? 'bg-danger' : 'bg-warning')} />}
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-52">
          <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
          {children.map((c) => (
            <DropdownMenuItem key={c.to} asChild className={cn(current === c && 'bg-accent text-foreground')}>
              <Link to={c.to}>{c.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className={cn(itemBase, active ? 'text-foreground' : 'text-sidebar-foreground hover:bg-accent/60 hover:text-foreground')}>
        {active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
        <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
        <span className="truncate">{item.label}</span>
        <CountBadge b={badge} className="mr-1" />
        <ChevronDown className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform', !badge && 'ml-auto', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden">
            <ul className="ml-[1.1rem] mt-0.5 space-y-px border-l border-border py-0.5 pl-2">
              {children.map((c) => {
                const isActive = current === c
                return (
                  <li key={c.to}>
                    <Link to={c.to} onClick={onNavigate} aria-current={isActive ? 'page' : undefined} className={cn('block truncate rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
                      {c.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SidebarContent({ collapsed, onNavigate, showCollapse }: { collapsed: boolean; onNavigate?: () => void; showCollapse?: boolean }) {
  const { pathname } = useLocation()
  const { permissions, user, role } = useCurrentUser()
  const badges = useNavBadges()
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const [manual, setManual] = React.useState<Record<string, boolean>>({})

  const groups = React.useMemo(
    () => NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.has(i.permission)) })).filter((g) => g.items.length),
    [permissions],
  )

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-12 shrink-0 items-center border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'justify-between px-3.5')}>
        <Link to="/dashboard" onClick={onNavigate} aria-label="FleetCore home"><Logo collapsed={collapsed} /></Link>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        {groups.map((g, gi) => (
          <div key={g.label} className={cn(gi > 0 && 'mt-1')}>
            {collapsed ? (gi > 0 && <div className="mx-3 my-2 h-px bg-sidebar-border" />) : <div className="label-xs px-2.5 pb-1 pt-3.5">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const badge = item.badge ? badges[item.badge] : undefined
                const autoOpen = !!item.children && !!activeChild(item.children, pathname)
                const open = manual[item.id] ?? autoOpen
                return (
                  <li key={item.id}>
                    {item.children ? (
                      <NavGroupItem item={item} collapsed={collapsed} badge={badge} pathname={pathname} open={open} onToggle={() => setManual((m) => ({ ...m, [item.id]: !open }))} onNavigate={onNavigate} />
                    ) : (
                      <NavLeaf item={item} collapsed={collapsed} badge={badge} active={pathname === item.to || pathname.startsWith(item.to + '/')} onNavigate={onNavigate} />
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('flex w-full items-center gap-2.5 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40', collapsed && 'justify-center')}>
              <Avatar name={user.name} size={30} />
              {!collapsed && (
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-foreground">{user.name}</span>
                  <span className="block truncate text-[11px] text-subtle-foreground">{role?.name}</span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="start" className="w-64">
            <UserMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
        {showCollapse && (
          <button type="button" onClick={toggleSidebar} className={cn('mt-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs text-subtle-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40', collapsed && 'justify-center px-0')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
          </button>
        )}
      </div>
    </div>
  )
}

/** Desktop sidebar (≥1024px). On smaller screens the shell renders `SidebarContent` inside a sheet instead. */
export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  return (
    <motion.aside initial={false} animate={{ width: collapsed ? 60 : 248 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }} className="relative z-30 hidden shrink-0 border-r border-sidebar-border lg:block">
      <SidebarContent collapsed={collapsed} showCollapse />
    </motion.aside>
  )
}

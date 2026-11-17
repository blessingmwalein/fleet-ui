import {
  BadgeDollarSign, BarChart3, Building2, ClipboardList, Fuel, LayoutDashboard, MapPinned, Package, Route, Settings, ShieldAlert, ShieldCheck, Truck, UserRound, Users, Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from './permissions'

export type NavBadgeKey = 'dispatch' | 'maintenance' | 'finance' | 'safety' | 'tracking'

export interface NavChild {
  label: string
  to: string
  permission?: Permission
}

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  /** direct link (leaf) */
  to?: string
  /** expandable submenu */
  children?: NavChild[]
  permission?: Permission
  badge?: NavBadgeKey
  /** Page manages its own scrolling/padding (e.g. the live map). */
  fullBleed?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard', permission: 'dashboard.view' },
      { id: 'tracking', label: 'Live Tracking', icon: MapPinned, to: '/tracking', permission: 'tracking.view', badge: 'tracking', fullBleed: true },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'dispatch', label: 'Dispatch Board', icon: ClipboardList, to: '/dispatch', permission: 'dispatch.view', badge: 'dispatch' },
      { id: 'trips', label: 'Trips', icon: Route, to: '/trips', permission: 'dispatch.view' },
      { id: 'shipments', label: 'Shipments', icon: Package, to: '/shipments', permission: 'shipments.view' },
      { id: 'customers', label: 'Customers', icon: Building2, to: '/customers', permission: 'shipments.view' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { id: 'vehicles', label: 'Vehicles', icon: Truck, to: '/vehicles', permission: 'vehicles.view' },
      { id: 'drivers', label: 'Drivers', icon: UserRound, to: '/drivers', permission: 'drivers.view' },
      {
        id: 'maintenance', label: 'Maintenance', icon: Wrench, permission: 'maintenance.view', badge: 'maintenance',
        children: [
          { label: 'Overview & calendar', to: '/maintenance' },
          { label: 'Work orders', to: '/maintenance/work-orders' },
          { label: 'Service schedules', to: '/maintenance/schedules' },
          { label: 'Inspections', to: '/maintenance/inspections' },
          { label: 'Service providers', to: '/maintenance/providers' },
        ],
      },
      {
        id: 'fuel', label: 'Fuel', icon: Fuel, permission: 'fuel.view',
        children: [
          { label: 'Overview', to: '/fuel' },
          { label: 'Transactions', to: '/fuel/transactions' },
          { label: 'Fuel cards', to: '/fuel/cards' },
          { label: 'Stations', to: '/fuel/stations' },
          { label: 'Reconciliation', to: '/fuel/reconciliation' },
        ],
      },
    ],
  },
  {
    label: 'Business',
    items: [
      {
        id: 'finance', label: 'Finance', icon: BadgeDollarSign, permission: 'finance.view', badge: 'finance',
        children: [
          { label: 'Overview', to: '/finance' },
          { label: 'Expenses', to: '/finance/expenses' },
          { label: 'Invoices', to: '/finance/invoices' },
          { label: 'Budgets', to: '/finance/budgets' },
          { label: 'Profitability', to: '/finance/profitability' },
        ],
      },
      {
        id: 'safety', label: 'Safety & Compliance', icon: ShieldCheck, permission: 'safety.view', badge: 'safety',
        children: [
          { label: 'Overview', to: '/safety' },
          { label: 'Incidents', to: '/safety/incidents' },
          { label: 'Driver behaviour', to: '/safety/behaviour' },
          { label: 'Compliance', to: '/safety/compliance' },
        ],
      },
      {
        id: 'reports', label: 'Reports', icon: BarChart3, permission: 'reports.view',
        children: [
          { label: 'Report centre', to: '/reports' },
          { label: 'Fleet utilisation', to: '/reports/fleet-utilisation' },
          { label: 'Vehicle performance', to: '/reports/vehicle-performance' },
          { label: 'Driver performance', to: '/reports/driver-performance' },
          { label: 'Trip performance', to: '/reports/trip-performance' },
          { label: 'Delivery performance', to: '/reports/delivery-performance' },
          { label: 'Fuel consumption', to: '/reports/fuel-consumption' },
          { label: 'Maintenance costs', to: '/reports/maintenance-costs' },
          { label: 'Operating expenses', to: '/reports/operating-expenses' },
          { label: 'Safety & incidents', to: '/reports/safety-incidents' },
          { label: 'Financial performance', to: '/reports/financial-performance' },
        ],
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        id: 'admin', label: 'Administration', icon: Settings, permission: 'admin.view',
        children: [
          { label: 'Users', to: '/admin/users' },
          { label: 'Roles & permissions', to: '/admin/roles' },
          { label: 'Organisation', to: '/admin/organisation' },
          { label: 'Notification preferences', to: '/admin/notifications' },
          { label: 'Audit log', to: '/admin/audit' },
          { label: 'Settings', to: '/admin/settings' },
        ],
      },
    ],
  },
]

export const QUICK_CREATE: { label: string; to: string; icon: LucideIcon; permission: Permission; description: string }[] = [
  { label: 'Create trip', to: '/dispatch?new=1', icon: Route, permission: 'dispatch.create', description: 'Schedule a new trip' },
  { label: 'Register shipment', to: '/shipments?new=1', icon: Package, permission: 'shipments.create', description: 'Book cargo for a customer' },
  { label: 'Register vehicle', to: '/vehicles?new=1', icon: Truck, permission: 'vehicles.create', description: 'Add a vehicle to the fleet' },
  { label: 'Add driver', to: '/drivers?new=1', icon: Users, permission: 'drivers.create', description: 'Onboard a new driver' },
  { label: 'Raise work order', to: '/maintenance/work-orders?new=1', icon: Wrench, permission: 'maintenance.create', description: 'Request maintenance or repair' },
  { label: 'Log fuel transaction', to: '/fuel/transactions?new=1', icon: Fuel, permission: 'fuel.create', description: 'Record a fuel purchase' },
  { label: 'Report incident', to: '/safety/incidents?new=1', icon: ShieldAlert, permission: 'safety.create', description: 'Accident, breakdown or theft' },
  { label: 'Submit expense', to: '/finance/expenses?new=1', icon: BadgeDollarSign, permission: 'finance.create', description: 'Claim a trip or fleet expense' },
]

/** Flat list of every navigable page with its group — used by breadcrumbs, search and the route guard. */
export interface FlatNav {
  label: string
  group: string
  parent?: string
  to: string
  permission?: Permission
  fullBleed?: boolean
  icon: LucideIcon
}

export const FLAT_NAV: FlatNav[] = NAV.flatMap<FlatNav>((g) =>
  g.items.flatMap<FlatNav>((it) =>
    it.to
      ? [{ label: it.label, group: g.label, to: it.to, permission: it.permission, fullBleed: it.fullBleed, icon: it.icon }]
      : (it.children ?? []).map((c) => ({ label: c.label, group: g.label, parent: it.label, to: c.to, permission: c.permission ?? it.permission, icon: it.icon })),
  ),
)

/** Best (longest-prefix) nav entry for a pathname. */
export function matchNav(pathname: string): FlatNav | undefined {
  let best: FlatNav | undefined
  for (const n of FLAT_NAV) {
    const base = n.to.split('?')[0]!
    if (pathname === base || pathname.startsWith(base + '/')) if (!best || base.length > best.to.length) best = n
  }
  return best
}


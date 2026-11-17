/**
 * Role-based access control catalogue.
 * Permission keys are `${module}.${action}`. The signed-in user's role determines which sidebar items,
 * routes and action buttons are available. Use `useCan('vehicles.edit')` / `<Can perm="...">`.
 */
export const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'tracking', label: 'Live Tracking' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'dispatch', label: 'Trips & Dispatch' },
  { key: 'shipments', label: 'Shipments & Customers' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'finance', label: 'Finance' },
  { key: 'safety', label: 'Safety & Compliance' },
  { key: 'reports', label: 'Reports' },
  { key: 'admin', label: 'Administration' },
] as const

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const

export type PermissionModule = (typeof PERMISSION_MODULES)[number]['key']
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]
export type Permission = `${PermissionModule}.${PermissionAction}`

export const ALL_PERMISSIONS: Permission[] = PERMISSION_MODULES.flatMap((m) =>
  PERMISSION_ACTIONS.map((a) => `${m.key}.${a}` as Permission),
)

const all = (m: PermissionModule): Permission[] => PERMISSION_ACTIONS.map((a) => `${m}.${a}` as Permission)
const some = (m: PermissionModule, ...a: PermissionAction[]): Permission[] => a.map((x) => `${m}.${x}` as Permission)

export interface RoleSeed {
  id: string
  name: string
  description: string
  permissions: Permission[]
}

export const ROLE_SEEDS: RoleSeed[] = [
  {
    id: 'role-super',
    name: 'Super Administrator',
    description: 'Unrestricted access to every module, including system administration.',
    permissions: ALL_PERMISSIONS,
  },
  {
    id: 'role-fleet',
    name: 'Fleet Manager',
    description: 'Runs day-to-day fleet operations: vehicles, drivers, dispatch, maintenance approvals and safety.',
    permissions: [
      ...all('dashboard'), ...all('tracking'), ...all('vehicles'), ...all('drivers'), ...all('dispatch'), ...all('shipments'),
      ...some('maintenance', 'view', 'create', 'edit', 'approve', 'export'),
      ...some('fuel', 'view', 'export', 'edit'),
      ...some('finance', 'view', 'export'),
      ...all('safety'), ...all('reports'),
      ...some('admin', 'view'),
    ],
  },
  {
    id: 'role-dispatch',
    name: 'Dispatcher',
    description: 'Creates and dispatches trips, assigns drivers and vehicles, monitors live tracking.',
    permissions: [
      ...some('dashboard', 'view'), ...some('tracking', 'view'), ...some('vehicles', 'view'), ...some('drivers', 'view'),
      ...some('dispatch', 'view', 'create', 'edit'), ...some('shipments', 'view', 'create', 'edit'),
      ...some('reports', 'view'),
    ],
  },
  {
    id: 'role-workshop',
    name: 'Workshop Manager',
    description: 'Manages work orders, service schedules, inspections and service providers.',
    permissions: [
      ...some('dashboard', 'view'), ...some('vehicles', 'view', 'edit'), ...all('maintenance'),
      ...some('fuel', 'view'), ...some('safety', 'view'), ...some('reports', 'view', 'export'),
    ],
  },
  {
    id: 'role-finance',
    name: 'Finance Officer',
    description: 'Expense approvals, invoicing, budgets and financial reporting.',
    permissions: [
      ...some('dashboard', 'view'), ...all('finance'), ...some('fuel', 'view', 'export', 'approve'),
      ...some('vehicles', 'view'), ...some('shipments', 'view'), ...some('reports', 'view', 'export'),
    ],
  },
  {
    id: 'role-safety',
    name: 'Safety Officer',
    description: 'Incident investigation, driver behaviour coaching and compliance tracking.',
    permissions: [
      ...some('dashboard', 'view'), ...some('tracking', 'view'), ...all('safety'),
      ...some('drivers', 'view', 'edit'), ...some('vehicles', 'view'), ...some('reports', 'view', 'export'),
    ],
  },
  {
    id: 'role-viewer',
    name: 'Read-only Viewer',
    description: 'View access to operational modules. No financial or administration access.',
    permissions: [
      ...some('dashboard', 'view'), ...some('tracking', 'view'), ...some('vehicles', 'view'), ...some('drivers', 'view'),
      ...some('dispatch', 'view'), ...some('shipments', 'view'), ...some('maintenance', 'view'), ...some('fuel', 'view'),
      ...some('safety', 'view'), ...some('reports', 'view'),
    ],
  },
]

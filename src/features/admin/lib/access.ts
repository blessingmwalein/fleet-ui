import { ALL_PERMISSIONS, PERMISSION_ACTIONS, PERMISSION_MODULES, type PermissionAction } from '@/config/permissions'
import { NAV, type NavGroup } from '@/config/navigation'
import type { Role, User } from '@/types'

export const ACTION_LABEL: Record<PermissionAction, string> = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve', export: 'Export' }
export const ACTION_SHORT: Record<PermissionAction, string> = { view: 'V', create: 'C', edit: 'E', delete: 'D', approve: 'A', export: 'X' }
export const TOTAL_PERMISSIONS = ALL_PERMISSIONS.length

/** Permissions in canonical catalogue order (stable diffs and storage). */
export function canonical(perms: Iterable<string>): string[] {
  const set = new Set(perms)
  return ALL_PERMISSIONS.filter((p) => set.has(p))
}

export function modulePerms(perms: Set<string> | string[], module: string): PermissionAction[] {
  const set = perms instanceof Set ? perms : new Set(perms)
  return PERMISSION_ACTIONS.filter((a) => set.has(`${module}.${a}`))
}

export function modulesWithAccess(perms: Set<string> | string[]): number {
  const set = perms instanceof Set ? perms : new Set(perms)
  return PERMISSION_MODULES.filter((m) => set.has(`${m.key}.view`)).length
}

export interface NavPreviewItem {
  id: string
  label: string
  to: string
  pages: number
  groupLabel: string
  visible: boolean
}

/** Same rule the sidebar uses (item permission) — returns every nav item with its visibility for a permission set. */
export function navPreview(perms: Set<string>): { group: NavGroup['label']; items: NavPreviewItem[] }[] {
  return NAV.map((g) => ({
    group: g.label,
    items: g.items.map((i) => ({
      id: i.id,
      label: i.label,
      to: i.to ?? i.children?.[0]?.to ?? '/dashboard',
      pages: i.children?.length ?? 1,
      groupLabel: g.label,
      visible: !i.permission || perms.has(i.permission),
    })),
  }))
}

/** First page a role can open (used after "Preview as role"). */
export function firstAccessiblePath(perms: Set<string>): string {
  for (const g of navPreview(perms)) for (const i of g.items) if (i.visible) return i.to
  return '/dashboard'
}

export interface AdminHolder {
  id: string
}

/** Active users whose role can edit administration data. At least one must always remain. */
export function adminEditors(users: User[], roles: Role[], overrides?: Record<string, string[]>): User[] {
  return users.filter((u) => {
    if (u.status !== 'active') return false
    const perms = overrides?.[u.roleId] ?? roles.find((r) => r.id === u.roleId)?.permissions ?? []
    return perms.includes('admin.edit')
  })
}

export function roleHasAdminEdit(roles: Role[], roleId: string) {
  return !!roles.find((r) => r.id === roleId)?.permissions.includes('admin.edit')
}

/** True when `user` is the only active administrator (removing/disabling/demoting them would lock everyone out). */
export function isLastAdmin(user: User, users: User[], roles: Role[]): boolean {
  const editors = adminEditors(users, roles)
  return editors.length === 1 && editors[0]!.id === user.id
}

export function diffPermissions(before: string[], after: Set<string>) {
  const b = new Set(before)
  const added = [...after].filter((p) => !b.has(p))
  const removed = before.filter((p) => !after.has(p))
  return { added, removed }
}

export function permissionLabel(p: string) {
  const [m, a] = p.split('.')
  const mod = PERMISSION_MODULES.find((x) => x.key === m)?.label ?? m
  return `${mod} · ${ACTION_LABEL[a as PermissionAction] ?? a}`
}

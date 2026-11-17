import { useMemo } from 'react'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import type { Permission } from '@/config/permissions'

/** The signed-in demo user plus their resolved role and permission set. */
export function useCurrentUser() {
  const userId = useSession((s) => s.userId)
  const users = useDb((s) => s.users)
  const roles = useDb((s) => s.roles)
  return useMemo(() => {
    const user = users.find((u) => u.id === userId) ?? users[0]!
    const role = roles.find((r) => r.id === user.roleId)
    const permissions = new Set<string>(role?.permissions ?? [])
    return { user, role, permissions }
  }, [userId, users, roles])
}

/** `const canEdit = useCan('vehicles.edit')` — gate buttons, menu items and routes. */
export function useCan(perm: Permission | Permission[], mode: 'any' | 'all' = 'any'): boolean {
  const { permissions } = useCurrentUser()
  const list = Array.isArray(perm) ? perm : [perm]
  return mode === 'any' ? list.some((p) => permissions.has(p)) : list.every((p) => permissions.has(p))
}

/** Non-reactive permission check for services / event handlers. */
export function can(perm: Permission): boolean {
  const { userId } = useSession.getState()
  const { users, roles } = useDb.getState()
  const user = users.find((u) => u.id === userId)
  return !!roles.find((r) => r.id === user?.roleId)?.permissions.includes(perm)
}

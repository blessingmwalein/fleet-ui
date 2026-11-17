import { toast } from 'sonner'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import { navigateTo } from '@/lib/navigation'
import type { User } from '@/types'
import { firstAccessiblePath } from './access'

/** The identity the demo session had before the first "preview" — so "Switch back" always returns to the real user. */
let originalUserId: string | null = null

export function switchBack() {
  const session = useSession.getState()
  if (originalUserId && originalUserId !== session.userId) {
    const u = useDb.getState().users.find((x) => x.id === originalUserId)
    session.switchUser(originalUserId)
    toast.success(`Back to ${u?.name ?? 'your account'}`)
    navigateTo('/admin/roles')
  }
  originalUserId = null
}

/**
 * Demo helper: sign in as another user so the sidebar, routes and action buttons follow that user's role.
 * Works for any active user; shows a toast with a one-click way back.
 */
export function previewAsUser(target: User) {
  const session = useSession.getState()
  const db = useDb.getState()
  if (session.userId === target.id) {
    toast.info('You are already signed in as this user')
    return
  }
  if (!originalUserId) originalUserId = session.userId
  const role = db.roles.find((r) => r.id === target.roleId)
  session.switchUser(target.id)
  const perms = new Set(role?.permissions ?? [])
  if (!perms.has('admin.view')) navigateTo(firstAccessiblePath(perms))
  toast.success(`Previewing the app as ${target.name}`, {
    description: `${role?.name ?? 'Unknown role'} — the sidebar, routes and buttons now follow this role.`,
    duration: 12000,
    action: originalUserId && originalUserId !== target.id ? { label: 'Switch back', onClick: switchBack } : undefined,
  })
}

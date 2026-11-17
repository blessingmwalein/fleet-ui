import { toast } from 'sonner'
import { useCurrentUser } from '@/hooks/useAuth'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import type { User } from '@/types'
import { isLastAdmin } from '../lib/access'

/** Account actions shared by the users table, bulk actions and the user drawer. All of them are audit-logged by `useDb`. */
export function useUserActions() {
  const { user: me } = useCurrentUser()

  const blockReason = (u: User, kind: 'disable' | 'delete'): string | null => {
    const { users, roles } = useDb.getState()
    if (u.id === me.id) return kind === 'delete' ? 'You cannot delete your own account.' : 'You cannot disable your own account.'
    if (isLastAdmin(u, users, roles)) return `${u.name} is the only active administrator — keep at least one active user with Administration · Edit.`
    return null
  }

  const disable = async (u: User) => {
    const reason = blockReason(u, 'disable')
    if (reason) return void toast.error(reason)
    const ok = await confirm({
      title: `Disable ${u.name}?`,
      description: 'They will no longer be able to sign in. Their history and audit trail are kept, and you can re-enable the account at any time.',
      confirmLabel: 'Disable user',
      destructive: true,
    })
    if (!ok) return
    useDb.getState().update('users', u.id, { status: 'disabled' }, { action: 'status', summary: `Disabled user ${u.name}` })
    toast.success(`${u.name} disabled`)
  }

  const enable = (u: User) => {
    useDb.getState().update('users', u.id, { status: 'active' }, { action: 'status', summary: `Enabled user ${u.name}` })
    toast.success(`${u.name} enabled`)
  }

  const toggleStatus = (u: User) => (u.status === 'disabled' ? enable(u) : disable(u))

  const resetPassword = async (u: User) => {
    const ok = await confirm({ title: `Reset password for ${u.name}?`, description: `A password reset link is emailed to ${u.email}. Their current password stops working once they set a new one.`, confirmLabel: 'Send reset link' })
    if (!ok) return
    useDb.getState().update('users', u.id, {}, { action: 'update', summary: `Sent password reset link to ${u.name} (${u.email})` })
    toast.success('Password reset link sent', { description: u.email })
  }

  const resendInvite = (u: User) => {
    useDb.getState().update('users', u.id, {}, { action: 'update', summary: `Resent invitation to ${u.name} (${u.email})` })
    toast.success('Invitation resent', { description: u.email })
  }

  const remove = async (u: User): Promise<boolean> => {
    const reason = blockReason(u, 'delete')
    if (reason) {
      toast.error(reason)
      return false
    }
    const ok = await confirm({
      title: `Delete ${u.name}?`,
      description: 'The account is removed permanently. Audit entries written by this user remain in the log. Consider disabling the account instead.',
      confirmLabel: 'Delete user',
      destructive: true,
    })
    if (!ok) return false
    useDb.getState().remove('users', u.id, { summary: `Deleted user ${u.name} (${u.email})` })
    toast.success(`${u.name} deleted`)
    return true
  }

  const disableMany = async (list: User[], done?: () => void) => {
    const eligible = list.filter((u) => u.status !== 'disabled' && !blockReason(u, 'disable'))
    if (!eligible.length) return void toast.error('None of the selected users can be disabled (own account, last administrator or already disabled).')
    const ok = await confirm({ title: `Disable ${eligible.length} user${eligible.length === 1 ? '' : 's'}?`, description: 'They will no longer be able to sign in.', confirmLabel: 'Disable', destructive: true })
    if (!ok) return
    useDb.getState().updateMany('users', eligible.map((u) => u.id), { status: 'disabled' }, { action: 'status', summary: `Disabled ${eligible.length} users` })
    toast.success(`${eligible.length} user${eligible.length === 1 ? '' : 's'} disabled${eligible.length < list.length ? ` (${list.length - eligible.length} skipped)` : ''}`)
    done?.()
  }

  const enableMany = (list: User[], done?: () => void) => {
    const eligible = list.filter((u) => u.status === 'disabled')
    if (!eligible.length) return void toast.info('No disabled users in the selection.')
    useDb.getState().updateMany('users', eligible.map((u) => u.id), { status: 'active' }, { action: 'status', summary: `Enabled ${eligible.length} users` })
    toast.success(`${eligible.length} user${eligible.length === 1 ? '' : 's'} enabled`)
    done?.()
  }

  const removeMany = async (list: User[], done?: () => void) => {
    const eligible = list.filter((u) => !blockReason(u, 'delete'))
    if (!eligible.length) return void toast.error('None of the selected users can be deleted (own account or last administrator).')
    const ok = await confirm({
      title: `Delete ${eligible.length} user${eligible.length === 1 ? '' : 's'}?`,
      description: `${eligible.map((u) => u.name).slice(0, 4).join(', ')}${eligible.length > 4 ? ` and ${eligible.length - 4} more` : ''} will be removed permanently.`,
      confirmLabel: 'Delete users',
      destructive: true,
    })
    if (!ok) return
    useDb.getState().removeMany('users', eligible.map((u) => u.id), { summary: `Deleted ${eligible.length} users` })
    toast.success(`${eligible.length} user${eligible.length === 1 ? '' : 's'} deleted${eligible.length < list.length ? ` (${list.length - eligible.length} skipped)` : ''}`)
    done?.()
  }

  return { me, blockReason, disable, enable, toggleStatus, resetPassword, resendInvite, remove, disableMany, enableMany, removeMany }
}

import { useMemo } from 'react'
import { useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ArrowRight } from 'lucide-react'
import { FormDialog } from '@/components/forms/FormDialog'
import { FormGrid, FormSection, SelectField, SwitchField, TextField, type AnyForm } from '@/components/forms/fields'
import { Badge } from '@/components/ui/display'
import { useCurrentUser } from '@/hooks/useAuth'
import { useDb } from '@/store/db'
import type { Role, User } from '@/types'
import { diffPermissions, isLastAdmin, navPreview, roleHasAdminEdit } from '../lib/access'

/** Shared validation for adding / editing a user. */
function useUserSchema(editingId: string | undefined) {
  const users = useDb((s) => s.users)
  return useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, 'Enter the full name').max(80, 'Name is too long'),
        email: z
          .string()
          .trim()
          .min(1, 'Email is required')
          .email('Enter a valid email address')
          .refine((v) => !users.some((u) => u.id !== editingId && u.email.toLowerCase() === v.toLowerCase()), 'Another user already has this email address'),
        phone: z.string().trim().min(1, 'Phone number is required').regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number, e.g. +263 77 123 4567'),
        roleId: z.string().min(1, 'Select a role'),
        branchId: z.string().min(1, 'Select a branch scope'),
        departmentId: z.string().min(1, 'Select a department'),
        status: z.enum(['active', 'invited', 'disabled']),
        twoFactor: z.boolean(),
      }),
    [users, editingId],
  )
}

function RoleHint({ form, roles }: { form: AnyForm; roles: Role[] }) {
  const roleId = useWatch({ control: form.control, name: 'roleId' }) as string | undefined
  const role = roles.find((r) => r.id === roleId)
  if (!role) return null
  const modules = new Set(role.permissions.map((p) => p.split('.')[0])).size
  return (
    <p className="-mt-1 rounded-md border border-border bg-surface-2/50 px-2.5 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{role.name}</span> — {role.description} <span className="num text-subtle-foreground">({role.permissions.length} permissions across {modules} modules)</span>
    </p>
  )
}

export function UserFormDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: User | null }) {
  const roles = useDb((s) => s.roles)
  const branches = useDb((s) => s.branches)
  const departments = useDb((s) => s.departments)
  const { user: me } = useCurrentUser()
  const schema = useUserSchema(user?.id)

  const defaults = useMemo(
    () =>
      user
        ? { name: user.name, email: user.email, phone: user.phone, roleId: user.roleId, branchId: user.branchId, departmentId: user.departmentId, status: user.status, twoFactor: user.twoFactor }
        : { name: '', email: '', phone: '+263 77 ', roleId: 'role-viewer', branchId: 'all', departmentId: departments[0]?.id ?? '', status: 'invited' as const, twoFactor: true },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, open],
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? `Edit ${user.name}` : 'Invite user'}
      description={user ? 'Update profile, access scope and account status.' : 'The user receives an email invitation to set a password and sign in.'}
      schema={schema}
      defaultValues={defaults}
      submitLabel={user ? 'Save changes' : 'Send invitation'}
      size="lg"
      onSubmit={(v) => {
        const db = useDb.getState()
        const role = db.roles.find((r) => r.id === v.roleId)
        if (user) {
          const demoting = (v.roleId !== user.roleId && !roleHasAdminEdit(db.roles, v.roleId)) || (v.status !== 'active' && user.status === 'active')
          if (demoting && isLastAdmin(user, db.users, db.roles)) throw new Error('This is the only active administrator. Keep at least one active user with Administration · Edit.')
          if (user.id === me.id && v.status === 'disabled') throw new Error('You cannot disable your own account.')
          if (user.id === me.id && !roleHasAdminEdit(db.roles, v.roleId) && v.roleId !== user.roleId) {
            const perms = db.roles.find((r) => r.id === v.roleId)?.permissions ?? []
            if (!perms.includes('admin.view')) throw new Error('You cannot remove your own access to Administration.')
          }
          const changes: string[] = []
          if (v.roleId !== user.roleId) changes.push(`role → ${role?.name}`)
          if (v.status !== user.status) changes.push(`status → ${v.status}`)
          if (v.branchId !== user.branchId) changes.push('branch scope')
          db.update('users', user.id, { ...v }, { summary: `Updated user ${v.name}${changes.length ? ` (${changes.join(', ')})` : ''}` })
          toast.success(`${v.name} updated`)
        } else {
          const created = db.insert(
            'users',
            { ...v, lastLogin: null, createdAt: new Date().toISOString() },
            { summary: `${v.status === 'invited' ? 'Invited' : 'Created'} ${v.name} (${role?.name ?? 'no role'})` },
          )
          toast.success(v.status === 'invited' ? `Invitation sent to ${created.email}` : `${created.name} added`)
        }
      }}
    >
      {(form) => (
        <>
          <FormSection title="Identity">
            <FormGrid>
              <TextField form={form} name="name" label="Full name" required placeholder="e.g. Tendai Moyo" autoComplete="off" />
              <TextField form={form} name="phone" label="Phone" required inputMode="tel" placeholder="+263 77 123 4567" />
              <TextField form={form} name="email" label="Work email" required type="email" placeholder="name@zambezifreight.co.zw" className="sm:col-span-2" autoComplete="off" />
            </FormGrid>
          </FormSection>
          <FormSection title="Access">
            <FormGrid>
              <SelectField form={form} name="roleId" label="Role" required options={roles.map((r) => ({ value: r.id, label: r.name }))} className="sm:col-span-2" />
            </FormGrid>
            <RoleHint form={form} roles={roles} />
            <FormGrid>
              <SelectField form={form} name="branchId" label="Branch scope" required options={[{ value: 'all', label: 'All branches (company-wide)' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
              <SelectField form={form} name="departmentId" label="Department" required options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            </FormGrid>
          </FormSection>
          <FormSection title="Account">
            <FormGrid>
              <SelectField
                form={form}
                name="status"
                label="Status"
                required
                options={[
                  { value: 'invited', label: 'Invited (pending sign-up)' },
                  { value: 'active', label: 'Active' },
                  { value: 'disabled', label: 'Disabled (cannot sign in)' },
                ]}
              />
              <SwitchField form={form} name="twoFactor" label="Two-factor authentication" hint="Require a one-time code at sign-in" className="self-end" />
            </FormGrid>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

const roleSchema = z.object({ roleId: z.string().min(1, 'Select a role') })

function RoleDelta({ form, user, roles }: { form: AnyForm; user: User; roles: Role[] }) {
  const roleId = useWatch({ control: form.control, name: 'roleId' }) as string | undefined
  const from = roles.find((r) => r.id === user.roleId)
  const to = roles.find((r) => r.id === roleId)
  if (!from || !to || from.id === to.id) return <p className="text-xs text-muted-foreground">Pick a different role to see what changes.</p>
  const { added, removed } = diffPermissions(from.permissions, new Set(to.permissions))
  const before = navPreview(new Set(from.permissions)).flatMap((g) => g.items).filter((i) => i.visible).length
  const after = navPreview(new Set(to.permissions)).flatMap((g) => g.items).filter((i) => i.visible).length
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone="outline">{from.name}</Badge>
        <ArrowRight className="size-3.5 text-muted-foreground" />
        <Badge tone="primary">{to.name}</Badge>
      </div>
      <p className="mt-2 text-muted-foreground">{to.description}</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <span className="text-success num">+{added.length} permissions</span>
        <span className="text-danger num">−{removed.length} permissions</span>
        <span className="text-muted-foreground num">
          Sidebar sections: {before} → {after}
        </span>
      </div>
    </div>
  )
}

export function ChangeRoleDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: User | null }) {
  const roles = useDb((s) => s.roles)
  const { user: me } = useCurrentUser()
  if (!user) return null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change role — ${user.name}`}
      description={user.id === me.id ? 'This is your own account. Changing your role takes effect immediately.' : 'The new role applies the next time the user loads the app.'}
      schema={roleSchema}
      defaultValues={{ roleId: user.roleId }}
      submitLabel="Change role"
      size="md"
      onSubmit={({ roleId }) => {
        const db = useDb.getState()
        if (roleId === user.roleId) throw new Error('The user already has this role.')
        const to = db.roles.find((r) => r.id === roleId)!
        if (!roleHasAdminEdit(db.roles, roleId) && isLastAdmin(user, db.users, db.roles)) throw new Error('This is the only active administrator. Keep at least one active user with Administration · Edit.')
        if (user.id === me.id && !to.permissions.includes('admin.view')) throw new Error('You cannot remove your own access to Administration.')
        const from = db.roles.find((r) => r.id === user.roleId)
        db.update('users', user.id, { roleId }, { action: 'update', summary: `Changed role of ${user.name}: ${from?.name ?? '—'} → ${to.name}` })
        toast.success(`${user.name} is now ${to.name}`)
      }}
    >
      {(form) => (
        <>
          <SelectField form={form} name="roleId" label="New role" required options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          <RoleDelta form={form} user={user} roles={roles} />
        </>
      )}
    </FormDialog>
  )
}

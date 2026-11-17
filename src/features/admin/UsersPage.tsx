import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Ban, BadgeCheck, CircleCheck, Eye, KeyRound, MailPlus, Pencil, ShieldCheck, ShieldOff, Trash2, UserCog, UserPlus, Users, UserCheck, UserX, MailQuestion } from 'lucide-react'
import { actionsColumn, DataTable } from '@/components/data-table/DataTable'
import { Avatar, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/shared/KpiCard'
import { Page, PageHeader } from '@/components/shared/Page'
import { useOpenParam } from '@/hooks/useLookup'
import { timeAgo } from '@/lib/format'
import { useDb } from '@/store/db'
import type { User } from '@/types'
import { adminEditors } from './lib/access'
import { previewAsUser } from './lib/preview'
import { RoleBadge, UserStatusBadge, useAdminCaps } from './components/AdminBits'
import { ChangeRoleDialog, UserFormDialog } from './components/UserDialogs'
import { UserDrawer } from './components/UserDrawer'
import { useUserActions } from './components/useUserActions'

interface UserRow extends User {
  roleName: string
  branchName: string
  departmentName: string
  isSelf: boolean
  twoFactorLabel: string
  lastLoginLabel: string
}

export default function UsersPage() {
  const users = useDb((s) => s.users)
  const roles = useDb((s) => s.roles)
  const branches = useDb((s) => s.branches)
  const departments = useDb((s) => s.departments)
  const caps = useAdminCaps()
  const actions = useUserActions()
  const [params, setParams] = useSearchParams()
  const [openId, setOpenId] = useOpenParam()
  const [form, setForm] = useState<{ open: boolean; user: User | null }>({ open: false, user: null }) // user null = invite new
  const setFormUser = (user: User | null) => setForm({ open: true, user })
  const [roleUser, setRoleUser] = useState<User | null>(null)

  // `?new=1` opens the invite dialog; `?open=<id>` opens the drawer (handled by useOpenParam).
  useEffect(() => {
    if (params.get('new') === '1' && caps.create) {
      setFormUser(null)
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }, [params, setParams, caps.create])

  // unknown / deleted user in a deep link
  useEffect(() => {
    if (openId && !users.some((u) => u.id === openId)) {
      toast.error('User not found', { description: 'The user in this link no longer exists.' })
      setOpenId(null)
    }
  }, [openId, users, setOpenId])

  const rows = useMemo<UserRow[]>(
    () =>
      users.map((u) => ({
        ...u,
        roleName: roles.find((r) => r.id === u.roleId)?.name ?? 'No role',
        branchName: u.branchId === 'all' ? 'All branches' : (branches.find((b) => b.id === u.branchId)?.name ?? '—'),
        departmentName: departments.find((d) => d.id === u.departmentId)?.name ?? '—',
        isSelf: u.id === actions.me.id,
        twoFactorLabel: u.twoFactor ? 'Enabled' : 'Disabled',
        lastLoginLabel: u.lastLogin ? timeAgo(u.lastLogin) : 'Never',
      })),
    [users, roles, branches, departments, actions.me.id],
  )

  const stats = useMemo(() => {
    const active = users.filter((u) => u.status === 'active')
    return {
      total: users.length,
      active: active.length,
      invited: users.filter((u) => u.status === 'invited').length,
      disabled: users.filter((u) => u.status === 'disabled').length,
      mfaPct: active.length ? Math.round((active.filter((u) => u.twoFactor).length / active.length) * 100) : 0,
      admins: adminEditors(users, roles).length,
    }
  }, [users, roles])

  const roleParam = params.get('role')
  const initialFilters = useMemo(() => {
    const r = roles.find((x) => x.id === roleParam)
    return r ? [{ id: 'roleName', value: [r.name] }] : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const columns = useMemo<ColumnDef<UserRow, any>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: 'User',
        size: 270,
        meta: { label: 'User', exportValue: (r) => r.name },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={row.original.name} size={28} />
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                <span className="truncate">{row.original.name}</span>
                {row.original.isSelf && <Badge tone="primary" className="px-1 py-px text-[10px]">You</Badge>}
              </div>
              <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
            </div>
          </div>
        ),
      },
      {
        id: 'roleName',
        accessorFn: (r) => r.roleName,
        header: 'Role',
        size: 170,
        filterFn: 'inArray',
        meta: { label: 'Role' },
        cell: ({ row }) => <RoleBadge role={roles.find((r) => r.id === row.original.roleId)} />,
      },
      { id: 'branchName', accessorFn: (r) => r.branchName, header: 'Branch', size: 190, filterFn: 'inArray', meta: { label: 'Branch', hideBelow: 'lg' } },
      { id: 'departmentName', accessorFn: (r) => r.departmentName, header: 'Department', size: 190, filterFn: 'inArray', meta: { label: 'Department', hideBelow: 'xl' } },
      {
        id: 'status',
        accessorFn: (r) => r.status,
        header: 'Status',
        size: 110,
        filterFn: 'inArray',
        meta: { label: 'Status' },
        cell: ({ row }) => <UserStatusBadge status={row.original.status} />,
      },
      {
        id: 'twoFactorLabel',
        accessorFn: (r) => r.twoFactorLabel,
        header: '2FA',
        size: 84,
        filterFn: 'inArray',
        meta: { label: 'Two-factor auth', align: 'center', hideBelow: 'md' },
        cell: ({ row }) =>
          row.original.twoFactor ? (
            <span className="inline-flex items-center gap-1 text-success"><ShieldCheck className="size-4" /></span>
          ) : (
            <span className="inline-flex items-center gap-1 text-subtle-foreground"><ShieldOff className="size-4" /></span>
          ),
      },
      {
        id: 'lastLogin',
        accessorFn: (r) => r.lastLogin ?? '',
        header: 'Last sign-in',
        size: 130,
        meta: { label: 'Last sign-in', hideBelow: 'md', exportValue: (r) => r.lastLogin },
        cell: ({ row }) => <span className={row.original.lastLogin ? 'text-muted-foreground' : 'text-subtle-foreground'}>{row.original.lastLoginLabel}</span>,
      },
      { id: 'phone', accessorFn: (r) => r.phone, header: 'Phone', size: 140, meta: { label: 'Phone' } },
      { id: 'createdAt', accessorFn: (r) => r.createdAt, header: 'Created', size: 120, meta: { label: 'Created' }, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('en-GB') },
      ...(caps.edit || caps.del
        ? [
            actionsColumn<UserRow>((u) => [
              { label: 'View details', icon: <Eye />, onClick: () => setOpenId(u.id) },
              { label: 'Edit user', icon: <Pencil />, hidden: !caps.edit, onClick: () => setFormUser(u) },
              { label: 'Change role', icon: <UserCog />, hidden: !caps.edit, onClick: () => setRoleUser(u) },
              { label: 'Preview as user', icon: <Eye />, hidden: u.status !== 'active' || u.isSelf, onClick: () => previewAsUser(u) },
              { label: 'Reset password', icon: <KeyRound />, hidden: !caps.edit || u.status === 'invited', separatorBefore: true, onClick: () => actions.resetPassword(u) },
              { label: 'Resend invitation', icon: <MailPlus />, hidden: !caps.edit || u.status !== 'invited', separatorBefore: true, onClick: () => actions.resendInvite(u) },
              { label: u.status === 'disabled' ? 'Enable user' : 'Disable user', icon: u.status === 'disabled' ? <CircleCheck /> : <Ban />, hidden: !caps.edit, onClick: () => actions.toggleStatus(u) },
              { label: 'Delete user', icon: <Trash2 />, destructive: true, hidden: !caps.del, separatorBefore: true, onClick: () => actions.remove(u) },
            ]) as ColumnDef<UserRow, any>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles, caps.edit, caps.del, actions.me.id],
  )

  const bulk = [
    ...(caps.edit
      ? [
          { label: 'Enable', icon: <CircleCheck />, onClick: (r: UserRow[], clear: () => void) => actions.enableMany(r, clear) },
          { label: 'Disable', icon: <Ban />, onClick: (r: UserRow[], clear: () => void) => actions.disableMany(r, clear) },
        ]
      : []),
    ...(caps.del ? [{ label: 'Delete', icon: <Trash2 />, destructive: true, onClick: (r: UserRow[], clear: () => void) => actions.removeMany(r, clear) }] : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Everyone who can sign in to FleetCore — their role, branch scope and account security."
        actions={
          caps.create && (
            <Button onClick={() => setFormUser(null)}>
              <UserPlus /> Invite user
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total users" value={stats.total} icon={Users} />
        <KpiCard label="Active" value={stats.active} icon={UserCheck} status="success" />
        <KpiCard label="Pending invitations" value={stats.invited} icon={MailQuestion} status={stats.invited ? 'warning' : undefined} />
        <KpiCard label="Disabled" value={stats.disabled} icon={UserX} />
        <KpiCard label="2FA coverage" value={stats.mfaPct} unit="%" icon={BadgeCheck} status={stats.mfaPct >= 90 ? 'success' : 'warning'} hint="Share of active users with two-factor authentication enabled" />
        <KpiCard label="Administrators" value={stats.admins} icon={ShieldCheck} hint="Active users whose role includes Administration · Edit" />
      </div>

      <DataTable<UserRow>
        tableId="admin-users"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        exportName={caps.exportCsv ? 'users' : undefined}
        searchPlaceholder="Search name, email, role, branch…"
        defaultSort={[{ id: 'name', desc: false }]}
        defaultHidden={['phone', 'createdAt']}
        initialFilters={initialFilters}
        selectable={caps.edit || caps.del}
        bulkActions={bulk}
        onRowClick={(u) => setOpenId(u.id)}
        facets={[
          { columnId: 'roleName', label: 'Role', options: roles.map((r) => ({ value: r.name, label: r.name })) },
          { columnId: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }, { value: 'disabled', label: 'Disabled' }] },
          { columnId: 'branchName', label: 'Branch', options: [{ value: 'All branches', label: 'All branches (company-wide)' }, ...branches.map((b) => ({ value: b.name, label: b.name }))] },
          { columnId: 'departmentName', label: 'Department', options: departments.map((d) => ({ value: d.name, label: d.name })) },
          { columnId: 'twoFactorLabel', label: '2FA', options: [{ value: 'Enabled', label: 'Enabled' }, { value: 'Disabled', label: 'Not enabled' }] },
        ]}
        emptyTitle="No users match"
        emptyDescription="Adjust the filters or invite a new user."
        mobileCard={(u) => (
          <div className="flex items-start gap-3">
            <Avatar name={u.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{u.name}{u.isSelf && ' (you)'}</span>
                <UserStatusBadge status={u.status} />
              </div>
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <RoleBadge role={roles.find((r) => r.id === u.roleId)} />
                <span className="text-xs text-subtle-foreground">{u.branchName}</span>
                {u.twoFactor ? <ShieldCheck className="size-3.5 text-success" /> : <ShieldOff className="size-3.5 text-subtle-foreground" />}
              </div>
            </div>
          </div>
        )}
      />

      <UserDrawer userId={openId} onClose={() => setOpenId(null)} onEdit={(u) => setFormUser(u)} onChangeRole={(u) => setRoleUser(u)} />
      <UserFormDialog open={form.open} onOpenChange={(o) => !o && setForm((f) => ({ ...f, open: false }))} user={form.user} />
      <ChangeRoleDialog open={!!roleUser} onOpenChange={(o) => !o && setRoleUser(null)} user={roleUser} />
    </Page>
  )
}

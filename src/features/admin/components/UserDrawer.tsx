import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Ban, CircleCheck, Eye, KeyRound, MailPlus, MoreHorizontal, Pencil, ShieldCheck, Trash2, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { Progress } from '@/components/ui/form-controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DetailGrid, Timeline, type TimelineItem } from '@/components/shared/Page'
import { EntityLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format'
import { useDb } from '@/store/db'
import type { User } from '@/types'
import { AUDIT_ACTION_LABEL } from '../lib/audit'
import { modulesWithAccess, navPreview, TOTAL_PERMISSIONS } from '../lib/access'
import { previewAsUser } from '../lib/preview'
import { PermissionSummary, RoleBadge, UserStatusBadge, useAdminCaps } from './AdminBits'
import { useUserActions } from './useUserActions'

export function UserDrawer({ userId, onClose, onEdit, onChangeRole }: { userId: string | null; onClose: () => void; onEdit: (u: User) => void; onChangeRole: (u: User) => void }) {
  const user = useDb((s) => s.users.find((u) => u.id === userId))
  const roles = useDb((s) => s.roles)
  const branches = useDb((s) => s.branches)
  const departments = useDb((s) => s.departments)
  const auditLog = useDb((s) => s.auditLog)
  const caps = useAdminCaps()
  const actions = useUserActions()

  const role = roles.find((r) => r.id === user?.roleId)
  const branch = user && user.branchId !== 'all' ? branches.find((b) => b.id === user.branchId) : undefined
  const department = departments.find((d) => d.id === user?.departmentId)
  const isSelf = user?.id === actions.me.id

  const activity = useMemo<TimelineItem[]>(() => {
    if (!user) return []
    return auditLog
      .filter((e) => e.userId === user.id || (e.entityType === 'user' && e.entityId === user.id))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 14)
      .map((e) => ({
        id: e.id,
        title: e.summary,
        description: `${AUDIT_ACTION_LABEL[e.action]} · ${e.entityType}${e.userId !== user.id ? ` · by ${e.userName}` : ''}`,
        time: timeAgo(e.at),
        tone: e.action === 'delete' ? ('danger' as const) : undefined,
      }))
  }, [auditLog, user])

  const perms = useMemo(() => new Set(role?.permissions ?? []), [role])
  const nav = useMemo(() => navPreview(perms).flatMap((g) => g.items), [perms])
  const visibleNav = nav.filter((i) => i.visible)

  return (
    <Sheet open={!!userId && !!user} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        {user && (
          <>
            <SheetHeader>
              <div className="flex items-start gap-3">
                <Avatar name={user.name} size={44} />
                <div className="min-w-0">
                  <SheetTitle className="flex flex-wrap items-center gap-2">
                    {user.name}
                    {isSelf && <Badge tone="primary">You</Badge>}
                  </SheetTitle>
                  <SheetDescription className="truncate">{user.email}</SheetDescription>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <UserStatusBadge status={user.status} />
                    <RoleBadge role={role} />
                    <Badge tone={user.twoFactor ? 'success' : 'warning'} className="gap-1">
                      <BadgeCheck /> 2FA {user.twoFactor ? 'on' : 'off'}
                    </Badge>
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
              {caps.edit && (
                <>
                  <Button size="sm" onClick={() => onEdit(user)}><Pencil /> Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => onChangeRole(user)}><UserCog /> Change role</Button>
                </>
              )}
              {user.status === 'active' && !isSelf && (
                <Button size="sm" variant="outline" onClick={() => previewAsUser(user)}><Eye /> Preview as user</Button>
              )}
              {(caps.edit || caps.del) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label="More actions"><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-52">
                    {caps.edit && user.status !== 'invited' && (
                      <DropdownMenuItem onSelect={() => actions.resetPassword(user)}><KeyRound /> Reset password</DropdownMenuItem>
                    )}
                    {caps.edit && user.status === 'invited' && (
                      <DropdownMenuItem onSelect={() => actions.resendInvite(user)}><MailPlus /> Resend invitation</DropdownMenuItem>
                    )}
                    {caps.edit && (
                      <DropdownMenuItem onSelect={() => actions.toggleStatus(user)}>
                        {user.status === 'disabled' ? <CircleCheck /> : <Ban />}
                        {user.status === 'disabled' ? 'Enable user' : 'Disable user'}
                      </DropdownMenuItem>
                    )}
                    {caps.del && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={async () => { if (await actions.remove(user)) onClose() }}><Trash2 /> Delete user</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <SheetBody className="px-0 py-0">
              <Tabs defaultValue="overview" className="flex min-h-0 flex-col">
                <TabsList className="px-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="permissions">Permissions</TabsTrigger>
                  <TabsTrigger value="activity">Activity <span className="num rounded bg-surface-3 px-1 text-[10px] text-muted-foreground">{activity.length}</span></TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-5 p-5">
                  <DetailGrid
                    columns={2}
                    items={[
                      { label: 'Email', value: <a className="hover:text-primary hover:underline" href={`mailto:${user.email}`}>{user.email}</a> },
                      { label: 'Phone', value: <a className="hover:text-primary hover:underline" href={`tel:${user.phone.replace(/\s/g, '')}`}>{user.phone}</a> },
                      { label: 'Role', value: role?.name ?? '—' },
                      { label: 'Department', value: department?.name ?? '—' },
                      { label: 'Branch scope', value: user.branchId === 'all' ? 'All branches (company-wide)' : branch ? <EntityLink type="branch" id={branch.id} /> : '—' },
                      { label: 'Last sign-in', value: user.lastLogin ? `${fmtDateTime(user.lastLogin)} (${timeAgo(user.lastLogin)})` : 'Never signed in' },
                      { label: 'Account created', value: fmtDate(user.createdAt) },
                      { label: 'User ID', value: <span className="font-mono text-xs">{user.id}</span> },
                    ]}
                  />
                  {user.status === 'invited' && (
                    <p className="rounded-md border border-info/25 bg-info/8 px-3 py-2 text-xs text-info">Invitation pending — the user has not set a password yet.</p>
                  )}
                  {user.status === 'disabled' && (
                    <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">This account is disabled and cannot sign in. History is preserved.</p>
                  )}
                  {!user.twoFactor && user.status === 'active' && (
                    <p className="rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning">Two-factor authentication is not enabled for this account.</p>
                  )}
                </TabsContent>

                <TabsContent value="permissions" className="space-y-4 p-5">
                  <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[13px] font-medium"><ShieldCheck className="size-4 text-primary" />{role?.name ?? 'No role'}</div>
                      <Button asChild size="xs" variant="outline"><Link to={`/admin/roles?role=${role?.id ?? ''}`}>Edit role permissions</Link></Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{role?.description}</p>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                      <div><div className="label-xs">Permissions</div><div className="num text-[15px] font-semibold">{role?.permissions.length ?? 0}<span className="text-xs font-normal text-subtle-foreground"> / {TOTAL_PERMISSIONS}</span></div></div>
                      <div><div className="label-xs">Modules</div><div className="num text-[15px] font-semibold">{modulesWithAccess(perms)}<span className="text-xs font-normal text-subtle-foreground"> / 12</span></div></div>
                      <div><div className="label-xs">Sidebar pages</div><div className="num text-[15px] font-semibold">{visibleNav.length}<span className="text-xs font-normal text-subtle-foreground"> / {nav.length}</span></div></div>
                    </div>
                    <Progress className="mt-3" value={((role?.permissions.length ?? 0) / TOTAL_PERMISSIONS) * 100} />
                  </div>
                  <PermissionSummary permissions={role?.permissions ?? []} />
                  <p className="text-[11px] text-subtle-foreground">V view · C create · E edit · D delete · A approve · X export</p>
                </TabsContent>

                <TabsContent value="activity" className="p-5">
                  {activity.length === 0 ? (
                    <EmptyState compact title="No recorded activity" description="Actions by this user and changes to their account appear here." />
                  ) : (
                    <Timeline items={activity} />
                  )}
                  <div className="mt-4">
                    <Button asChild size="sm" variant="outline"><Link to="/admin/audit">Open audit log</Link></Button>
                  </div>
                </TabsContent>
              </Tabs>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

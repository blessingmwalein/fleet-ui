import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Copy, Eye, EyeOff, Lock, PanelLeft, Pencil, Plus, Save, ShieldCheck, Trash2, Undo2, Users } from 'lucide-react'
import { FormDialog } from '@/components/forms/FormDialog'
import { SelectField, TextAreaField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { Checkbox, Progress } from '@/components/ui/form-controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/menus'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/overlays'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink } from '@/components/shared/EntityLink'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { ALL_PERMISSIONS, PERMISSION_ACTIONS, PERMISSION_MODULES, type PermissionAction } from '@/config/permissions'
import { useCurrentUser } from '@/hooks/useAuth'
import { navigateTo } from '@/lib/navigation'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import { cn } from '@/lib/utils'
import type { Role } from '@/types'
import { ACTION_LABEL, ACTION_SHORT, adminEditors, canonical, diffPermissions, modulesWithAccess, navPreview, permissionLabel, TOTAL_PERMISSIONS } from './lib/access'
import { previewAsUser } from './lib/preview'
import { PermissionPips, RoleBadge, UserStatusBadge, useAdminCaps, ReadOnlyNotice, MiniStat } from './components/AdminBits'

type CheckState = boolean | 'indeterminate'

const roleFormSchema = (roles: Role[], editingId?: string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(3, 'Role name must be at least 3 characters')
      .max(40, 'Role name is too long')
      .refine((v) => !roles.some((r) => r.id !== editingId && r.name.toLowerCase() === v.toLowerCase()), 'A role with this name already exists'),
    description: z.string().trim().min(5, 'Add a short description of what this role is for').max(200, 'Keep the description under 200 characters'),
    cloneFrom: z.string().optional(),
  })

export default function RolesPage() {
  const roles = useDb((s) => s.roles)
  const users = useDb((s) => s.users)
  const caps = useAdminCaps()
  const { user: me } = useCurrentUser()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'editor' | 'compare'>('editor')
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'clone'>(null)

  const selectedId = roles.some((r) => r.id === params.get('role')) ? params.get('role')! : (roles.find((r) => r.id === me.roleId)?.id ?? roles[0]?.id ?? '')
  const role = roles.find((r) => r.id === selectedId)
  const select = (id: string) => {
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('role', id)
      return n
    }, { replace: true })
    setView('editor')
  }

  const [draft, setDraft] = useState<Set<string>>(() => new Set(role?.permissions ?? []))
  const savedKey = role?.permissions.join(',') ?? ''
  useEffect(() => {
    setDraft(new Set(role?.permissions ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role?.id, savedKey])

  const members = useMemo(() => users.filter((u) => u.roleId === selectedId), [users, selectedId])
  const memberCount = (id: string) => users.filter((u) => u.roleId === id).length
  const { added, removed } = useMemo(() => diffPermissions(role?.permissions ?? [], draft), [role, draft])
  const dirty = added.length + removed.length > 0
  const readOnly = !caps.edit

  // ---- draft editing (view is a prerequisite for every other action) ----
  const apply = (n: Set<string>, mod: string, action: PermissionAction, on: boolean) => {
    const key = `${mod}.${action}`
    if (on) {
      n.add(key)
      if (action !== 'view') n.add(`${mod}.view`)
    } else {
      n.delete(key)
      if (action === 'view') for (const a of PERMISSION_ACTIONS) n.delete(`${mod}.${a}`)
    }
  }
  const toggle = (mod: string, action: PermissionAction, on: boolean) => setDraft((d) => { const n = new Set(d); apply(n, mod, action, on); return n })
  const toggleRow = (mod: string, on: boolean) => setDraft((d) => { const n = new Set(d); for (const a of PERMISSION_ACTIONS) apply(n, mod, a, on); return n })
  const toggleCol = (action: PermissionAction, on: boolean) => setDraft((d) => { const n = new Set(d); for (const m of PERMISSION_MODULES) apply(n, m.key, action, on); return n })
  const setAll = (on: boolean) => setDraft(on ? new Set(ALL_PERMISSIONS) : new Set())

  const colState = (a: PermissionAction): CheckState => {
    const c = PERMISSION_MODULES.filter((m) => draft.has(`${m.key}.${a}`)).length
    return c === 0 ? false : c === PERMISSION_MODULES.length ? true : 'indeterminate'
  }
  const rowState = (mod: string): CheckState => {
    const c = PERMISSION_ACTIONS.filter((a) => draft.has(`${mod}.${a}`)).length
    return c === 0 ? false : c === PERMISSION_ACTIONS.length ? true : 'indeterminate'
  }

  const save = async () => {
    if (!role || !dirty) return
    const db = useDb.getState()
    if (db.users.some((u) => u.id === me.id && u.roleId === role.id) && !draft.has('admin.view')) return void toast.error('You would lock yourself out', { description: 'Your own role needs Administration · View. Switch to another user to remove it.' })
    if (adminEditors(db.users, db.roles, { [role.id]: [...draft] }).length === 0) return void toast.error('At least one active user must keep Administration · Edit', { description: 'Saving would leave nobody able to manage the system.' })
    if (role.builtIn) {
      const ok = await confirm({
        title: `Change built-in role “${role.name}”?`,
        description: `This is a built-in role used by ${members.length} user${members.length === 1 ? '' : 's'}. The change (+${added.length} / −${removed.length} permissions) applies to them immediately and also affects what they see in the sidebar.`,
        confirmLabel: 'Save changes',
      })
      if (!ok) return
    }
    db.update('roles', role.id, { permissions: canonical(draft) }, { summary: `Updated permissions for ${role.name} (+${added.length} / −${removed.length})` })
    toast.success(`${role.name} updated`, { description: `${added.length} added, ${removed.length} removed.` })
  }

  const deleteRole = async () => {
    if (!role || role.builtIn) return
    if (members.length) return void toast.error(`“${role.name}” is still assigned to ${members.length} user${members.length === 1 ? '' : 's'}`, { description: 'Reassign them to another role before deleting it.', action: { label: 'View users', onClick: () => navigateTo(`/admin/users?role=${role.id}`) } })
    if (!(await confirm({ title: `Delete role “${role.name}”?`, description: 'This permanently removes the role and its permission set. No users hold it.', confirmLabel: 'Delete role', destructive: true }))) return
    useDb.getState().remove('roles', role.id, { summary: `Deleted role ${role.name}` })
    toast.success(`Role “${role.name}” deleted`)
    select(roles.find((r) => r.id !== role.id)?.id ?? '')
  }

  const previewCandidates = members.filter((u) => u.status === 'active' && u.id !== me.id)
  const isMine = role?.id === me.roleId

  const baseline = useMemo(() => new Set(role?.permissions ?? []), [role])
  const navDraft = useMemo(() => navPreview(draft), [draft])
  const navBase = useMemo(() => navPreview(baseline), [baseline])
  const visibleCount = navDraft.flatMap((g) => g.items).filter((i) => i.visible).length
  const totalNav = navDraft.flatMap((g) => g.items).length

  const preview = async () => {
    if (!role) return
    if (dirty) {
      const ok = await confirm({ title: 'Save changes before previewing?', description: 'Preview uses the saved permissions of this role.', confirmLabel: 'Save & preview' })
      if (!ok) return
      await save()
    }
    if (previewCandidates.length === 1) previewAsUser(previewCandidates[0]!)
  }

  return (
    <Page>
      <PageHeader
        title="Roles & permissions"
        description="Define what each role can see and do. Changes apply immediately — use “Preview as role” to see the sidebar the way members see it."
        actions={
          <>
            <Segmented
              aria-label="View"
              value={view}
              onChange={setView}
              size="md"
              options={[{ value: 'editor', label: 'Editor' }, { value: 'compare', label: 'Compare roles' }]}
            />
            {caps.create && (
              <Button onClick={() => setDialog('new')}>
                <Plus /> New role
              </Button>
            )}
          </>
        }
      />
      {readOnly && <ReadOnlyNotice what="roles and permissions" />}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ---- role list ---- */}
        <Panel title="Roles" description={`${roles.length} roles · ${roles.filter((r) => !r.builtIn).length} custom`} flush className="self-start">
          <ul className="max-h-[70vh] divide-y divide-border/70 overflow-y-auto">
            {roles.map((r) => {
              const active = r.id === selectedId && view === 'editor'
              const n = memberCount(r.id)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => select(r.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn('relative block w-full px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40', active && 'bg-primary/8')}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{r.name}</span>
                      <Badge tone={r.builtIn ? 'neutral' : 'primary'}>{r.builtIn ? 'Built-in' : 'Custom'}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Progress className="h-1 flex-1" value={(r.permissions.length / TOTAL_PERMISSIONS) * 100} />
                      <span className="num text-[11px] text-subtle-foreground">{r.permissions.length}/{TOTAL_PERMISSIONS}</span>
                      <span className="num inline-flex items-center gap-1 text-[11px] text-subtle-foreground"><Users className="size-3" />{n}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>

        {view === 'compare' ? (
          <CompareRoles roles={roles} onSelect={select} />
        ) : !role ? (
          <Panel><EmptyState title="No role selected" description="Create a role to get started." /></Panel>
        ) : (
          <div className="min-w-0 space-y-4">
            {/* ---- header ---- */}
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold tracking-tight">{role.name}</h2>
                    <RoleBadge role={role} />
                    {isMine && <Badge tone="info">Your role</Badge>}
                  </div>
                  <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{role.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isMine ? (
                    <Tooltip content="You are signed in with this role — the sidebar already reflects it"><span><Button size="sm" variant="outline" disabled><Eye /> Preview as role</Button></span></Tooltip>
                  ) : previewCandidates.length === 0 ? (
                    <Tooltip content="No active user holds this role. Assign it to a user to preview it."><span><Button size="sm" variant="outline" disabled><EyeOff /> Preview as role</Button></span></Tooltip>
                  ) : previewCandidates.length === 1 ? (
                    <Button size="sm" variant="outline" onClick={preview}><Eye /> Preview as role</Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Eye /> Preview as role</Button></DropdownMenuTrigger>
                      <DropdownMenuContent className="w-60">
                        <DropdownMenuLabel>Sign in as…</DropdownMenuLabel>
                        {previewCandidates.map((u) => (
                          <DropdownMenuItem key={u.id} onSelect={async () => { if (dirty) { const ok = await confirm({ title: 'Save changes before previewing?', description: 'Preview uses the saved permissions of this role.', confirmLabel: 'Save & preview' }); if (!ok) return; await save() } previewAsUser(u) }}>
                            <Avatar name={u.name} size={20} /> {u.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {caps.create && <Button size="sm" variant="outline" onClick={() => setDialog('clone')}><Copy /> Clone</Button>}
                  {caps.edit && <Button size="sm" variant="outline" onClick={() => setDialog('edit')}><Pencil /> Edit details</Button>}
                  {caps.del && (
                    <Tooltip content={role.builtIn ? 'Built-in roles cannot be deleted' : members.length ? 'Reassign members first' : undefined}>
                      <span><Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" disabled={role.builtIn} onClick={deleteRole}><Trash2 /> Delete</Button></span>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-3 sm:grid-cols-4">
                <MiniStat label="Permissions" value={<>{draft.size}<span className="text-xs font-normal text-subtle-foreground"> / {TOTAL_PERMISSIONS}</span></>} />
                <MiniStat label="Modules with access" value={<>{modulesWithAccess(draft)}<span className="text-xs font-normal text-subtle-foreground"> / {PERMISSION_MODULES.length}</span></>} />
                <MiniStat label="Sidebar sections" value={<>{visibleCount}<span className="text-xs font-normal text-subtle-foreground"> / {totalNav}</span></>} />
                <MiniStat label="Members" value={members.length} hint={members.filter((m) => m.status === 'active').length + ' active'} />
              </div>
              {role.builtIn && (
                <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning">
                  <Lock className="mt-px size-3.5 shrink-0" />
                  <span>Built-in role. You can adjust its permissions, but doing so changes access for every member ({members.length}) — a confirmation is required when saving.</span>
                </p>
              )}
            </Panel>

            {/* ---- unsaved bar ---- */}
            {dirty && (
              <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-card px-3.5 py-2.5 shadow-pop">
                <div className="text-[13px]">
                  <span className="font-medium">Unsaved changes</span>
                  <span className="ml-2 text-success num">+{added.length}</span>
                  <span className="ml-1.5 text-danger num">−{removed.length}</span>
                  <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{[...added.slice(0, 2), ...removed.slice(0, 1)].map(permissionLabel).join(', ')}{added.length + removed.length > 3 ? '…' : ''}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(new Set(role.permissions))}><Undo2 /> Discard</Button>
                  <Button size="sm" onClick={save}><Save /> Save changes</Button>
                </div>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
              {/* ---- matrix ---- */}
              <Panel
                title="Permission matrix"
                description="Tick what this role may do in each module. Create, edit, delete, approve and export require View."
                flush
                actions={
                  !readOnly && (
                    <>
                      <Button size="xs" variant="ghost" onClick={() => setAll(true)}>All</Button>
                      <Button size="xs" variant="ghost" onClick={() => setAll(false)}>None</Button>
                    </>
                  )
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
                        <th className="sticky left-0 z-10 bg-surface-2 px-3.5 py-2 text-left font-medium">Module</th>
                        {PERMISSION_ACTIONS.map((a) => (
                          <th key={a} className="px-2 py-2 text-center font-medium">
                            <label className="inline-flex cursor-pointer flex-col items-center gap-1">
                              {ACTION_LABEL[a]}
                              <Checkbox aria-label={`Toggle ${ACTION_LABEL[a]} for all modules`} disabled={readOnly} checked={colState(a)} onCheckedChange={(v) => toggleCol(a, v === true)} />
                            </label>
                          </th>
                        ))}
                        <th className="px-3 py-2 text-center font-medium">Row</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PERMISSION_MODULES.map((m) => (
                        <tr key={m.key} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                          <td className="sticky left-0 z-10 bg-card px-3.5 py-1.5 font-medium">{m.label}</td>
                          {PERMISSION_ACTIONS.map((a) => {
                            const key = `${m.key}.${a}`
                            const on = draft.has(key)
                            const changed = on !== baseline.has(key)
                            return (
                              <td key={a} className={cn('px-2 py-1.5 text-center', changed && (on ? 'bg-success/10' : 'bg-danger/10'))}>
                                <Checkbox aria-label={`${m.label}: ${ACTION_LABEL[a]}`} disabled={readOnly} checked={on} onCheckedChange={(v) => toggle(m.key, a, v === true)} />
                              </td>
                            )
                          })}
                          <td className="px-3 py-1.5 text-center">
                            <Checkbox aria-label={`Toggle every permission for ${m.label}`} disabled={readOnly} checked={rowState(m.key)} onCheckedChange={(v) => toggleRow(m.key, v === true)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-border px-3.5 py-2 text-[11px] text-subtle-foreground">Highlighted cells differ from the saved role. {PERMISSION_ACTIONS.map((a) => `${ACTION_SHORT[a]} = ${ACTION_LABEL[a].toLowerCase()}`).join(' · ')}</p>
              </Panel>

              {/* ---- live sidebar preview ---- */}
              <Panel title="Sidebar preview" description="What members of this role see" className="self-start" actions={<PanelLeft className="size-4 text-muted-foreground" />}>
                <div className="space-y-3">
                  {navDraft.map((g, gi) => (
                    <div key={g.group}>
                      <div className="label-xs mb-1">{g.group}</div>
                      <ul className="space-y-0.5">
                        {g.items.map((it, ii) => {
                          const was = navBase[gi]!.items[ii]!.visible
                          return (
                            <li key={it.id} className={cn('flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[13px]', it.visible ? 'bg-surface-2' : 'text-subtle-foreground line-through decoration-subtle-foreground/50')}>
                              <span className="flex min-w-0 items-center gap-1.5 truncate">
                                {it.visible ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : <Lock className="size-3 shrink-0" />}
                                <span className="truncate">{it.label}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                {it.visible !== was && <Badge tone={it.visible ? 'success' : 'danger'} className="px-1 py-px text-[10px]">{it.visible ? 'new' : 'hidden'}</Badge>}
                                {it.pages > 1 && <span className="num text-[11px] text-subtle-foreground">{it.pages} pages</span>}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* ---- members ---- */}
            <Panel title={`Members (${members.length})`} description="Users who currently hold this role" flush actions={<Button asChild size="xs" variant="ghost"><Link to={`/admin/users?role=${role.id}`}>Open in Users</Link></Button>}>
              {members.length === 0 ? (
                <EmptyState compact title="Nobody holds this role yet" description="Assign it from Users → Change role." />
              ) : (
                <ul className="grid divide-y divide-border/70 sm:grid-cols-2 sm:divide-y-0">
                  {members.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 px-3.5 py-2 sm:border-b sm:border-border/70">
                      <span className="flex min-w-0 items-center gap-2"><Avatar name={u.name} size={24} /><EntityLink type="user" id={u.id} /></span>
                      <UserStatusBadge status={u.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </div>

      <RoleFormDialog open={dialog !== null} mode={dialog ?? 'new'} onOpenChange={(o) => !o && setDialog(null)} role={role} roles={roles} onCreated={select} />
    </Page>
  )
}

function RoleFormDialog({ open, mode, onOpenChange, role, roles, onCreated }: { open: boolean; mode: 'new' | 'edit' | 'clone'; onOpenChange: (o: boolean) => void; role?: Role; roles: Role[]; onCreated: (id: string) => void }) {
  const editing = mode === 'edit' ? role : undefined
  const schema = useMemo(() => roleFormSchema(roles, editing?.id), [roles, editing?.id])
  const defaults = useMemo(
    () =>
      mode === 'edit' && role
        ? { name: role.name, description: role.description, cloneFrom: '' }
        : mode === 'clone' && role
          ? { name: `${role.name} (copy)`, description: role.description, cloneFrom: role.id }
          : { name: '', description: '', cloneFrom: role?.id ?? '' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, role?.id, open],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'edit' ? 'Edit role details' : mode === 'clone' ? `Clone ${role?.name}` : 'New role'}
      description={mode === 'edit' ? 'Rename the role or update its description.' : 'The new role starts with a copy of the permissions you pick — then fine-tune them in the matrix.'}
      schema={schema}
      defaultValues={defaults}
      submitLabel={mode === 'edit' ? 'Save details' : 'Create role'}
      onSubmit={(v) => {
        const db = useDb.getState()
        if (editing) {
          const patch = editing.builtIn ? { description: v.description } : { name: v.name, description: v.description }
          db.update('roles', editing.id, patch, { summary: `Updated role details for ${editing.name}` })
          toast.success('Role details saved')
          return
        }
        const source = roles.find((r) => r.id === v.cloneFrom)
        const created = db.insert('roles', { name: v.name, description: v.description, permissions: [...(source?.permissions ?? ['dashboard.view'])], builtIn: false }, { summary: `Created role ${v.name}${source ? ` (cloned from ${source.name})` : ''}` })
        toast.success(`Role “${created.name}” created`, { description: 'Adjust its permissions in the matrix, then assign it to users.' })
        onCreated(created.id)
      }}
    >
      {(form) => (
        <>
          <TextField form={form} name="name" label="Role name" required placeholder="e.g. Regional Supervisor" disabled={!!editing?.builtIn} hint={editing?.builtIn ? 'Built-in role names cannot be changed.' : undefined} />
          <TextAreaField form={form} name="description" label="Description" required rows={3} placeholder="What is this role responsible for?" />
          {!editing && <SelectField form={form} name="cloneFrom" label="Start from" allowEmpty emptyLabel="Dashboard view only" options={roles.map((r) => ({ value: r.id, label: `${r.name} (${r.permissions.length} permissions)` }))} />}
        </>
      )}
    </FormDialog>
  )
}

/** Read-only comparison of every role across every module. */
function CompareRoles({ roles, onSelect }: { roles: Role[]; onSelect: (id: string) => void }) {
  return (
    <Panel title="Compare roles" description="Granted actions per module. Click a role to edit it." flush className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth: 200 + roles.length * 150 }}>
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="sticky left-0 z-10 w-44 bg-surface-2 px-3.5 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Module</th>
              {roles.map((r) => (
                <th key={r.id} className="px-2 py-2 text-left">
                  <button type="button" onClick={() => onSelect(r.id)} className="text-left text-xs font-semibold hover:text-primary hover:underline">{r.name}</button>
                  <div className="num text-[11px] font-normal text-subtle-foreground">{r.permissions.length}/{TOTAL_PERMISSIONS}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((m) => (
              <tr key={m.key} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                <td className="sticky left-0 z-10 bg-card px-3.5 py-1.5 font-medium">{m.label}</td>
                {roles.map((r) => {
                  const granted = new Set(PERMISSION_ACTIONS.filter((a) => r.permissions.includes(`${m.key}.${a}`)))
                  return <td key={r.id} className="px-2 py-1.5"><PermissionPips granted={granted} /></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-3.5 py-2 text-[11px] text-subtle-foreground"><ShieldCheck className="mr-1 inline size-3" />V view · C create · E edit · D delete · A approve · X export</p>
    </Panel>
  )
}

import * as React from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { z } from 'zod'
import { Briefcase, Landmark, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { actionsColumn, DataTable } from '@/components/data-table/DataTable'
import { BarList } from '@/components/charts/charts'
import { FormDialog } from '@/components/forms/FormDialog'
import { FormGrid, NumberField, TextAreaField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/shared/KpiCard'
import { Panel } from '@/components/shared/Page'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import type { Department } from '@/types'
import { Chip, useAdminCaps } from './AdminBits'

interface DeptRow extends Department {
  users: number
}

export function DepartmentsTab() {
  const departments = useDb((s) => s.departments)
  const users = useDb((s) => s.users)
  const caps = useAdminCaps()
  const [form, setForm] = React.useState<{ open: boolean; dept: Department | null }>({ open: false, dept: null })

  const rows = React.useMemo<DeptRow[]>(() => departments.map((d) => ({ ...d, users: users.filter((u) => u.departmentId === d.id).length })), [departments, users])
  const totalHeadcount = rows.reduce((s, d) => s + d.headcount, 0)
  const assigned = rows.reduce((s, d) => s + d.users, 0)

  const remove = async (d: DeptRow, silent = false): Promise<boolean> => {
    if (d.users > 0) {
      if (!silent) toast.error(`${d.name} still has ${d.users} user${d.users === 1 ? '' : 's'}`, { description: 'Move them to another department first.' })
      return false
    }
    if (!silent && !(await confirm({ title: `Delete ${d.name}?`, description: 'The department and its cost centre are removed. No users are assigned to it.', confirmLabel: 'Delete department', destructive: true }))) return false
    useDb.getState().remove('departments', d.id, { summary: `Deleted department ${d.name}` })
    if (!silent) toast.success(`${d.name} deleted`)
    return true
  }

  const columns = React.useMemo<ColumnDef<DeptRow, any>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: 'Department',
        size: 260,
        meta: { label: 'Department' },
        cell: ({ row }) => (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-medium">{row.original.name}</div>
            <div className="truncate text-xs text-muted-foreground">{row.original.description}</div>
          </div>
        ),
      },
      { id: 'head', accessorFn: (r) => r.head, header: 'Department head', size: 170, meta: { label: 'Head' } },
      { id: 'costCentre', accessorFn: (r) => r.costCentre, header: 'Cost centre', size: 110, meta: { label: 'Cost centre' }, cell: ({ row }) => <Chip>{row.original.costCentre}</Chip> },
      { id: 'headcount', accessorFn: (r) => r.headcount, header: 'Headcount', size: 100, meta: { label: 'Headcount', align: 'right' } },
      {
        id: 'users',
        accessorFn: (r) => r.users,
        header: 'System users',
        size: 110,
        meta: { label: 'System users', align: 'right' },
        cell: ({ row }) => (row.original.users ? <Link to={`/admin/users?dept=${row.original.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary hover:underline">{row.original.users}</Link> : <span className="text-subtle-foreground">0</span>),
      },
      { id: 'description', accessorFn: (r) => r.description, header: 'Description', size: 320, meta: { label: 'Description' } },
      ...(caps.edit || caps.del
        ? [
            actionsColumn<DeptRow>((d) => [
              { label: 'Edit department', icon: <Pencil />, hidden: !caps.edit, onClick: () => setForm({ open: true, dept: d }) },
              { label: 'Delete department', icon: <Trash2 />, destructive: true, hidden: !caps.del, separatorBefore: true, onClick: () => remove(d) },
            ]) as ColumnDef<DeptRow, any>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caps.edit, caps.del],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Departments" value={rows.length} icon={Briefcase} />
        <KpiCard label="Total headcount" value={totalHeadcount} icon={Users} />
        <KpiCard label="Users assigned" value={assigned} icon={Users} hint="System users linked to a department" />
        <KpiCard label="Cost centres" value={new Set(rows.map((r) => r.costCentre)).size} icon={Landmark} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <DataTable<DeptRow>
          tableId="admin-departments"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          exportName={caps.exportCsv ? 'departments' : undefined}
          searchPlaceholder="Search department, head, cost centre…"
          defaultSort={[{ id: 'name', desc: false }]}
          defaultHidden={['description']}
          selectable={caps.del}
          bulkActions={
            caps.del
              ? [
                  {
                    label: 'Delete',
                    icon: <Trash2 />,
                    destructive: true,
                    onClick: async (sel, clear) => {
                      const ok = sel.filter((d) => d.users === 0)
                      if (!ok.length) return void toast.error('Every selected department still has users assigned.')
                      if (!(await confirm({ title: `Delete ${ok.length} department${ok.length === 1 ? '' : 's'}?`, description: sel.length > ok.length ? `${sel.length - ok.length} selected department(s) with users will be skipped.` : 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return
                      useDb.getState().removeMany('departments', ok.map((d) => d.id), { summary: `Deleted ${ok.length} departments` })
                      toast.success(`${ok.length} department${ok.length === 1 ? '' : 's'} deleted`)
                      clear()
                    },
                  },
                ]
              : undefined
          }
          onRowClick={caps.edit ? (d) => setForm({ open: true, dept: d }) : undefined}
          actions={caps.create && <Button size="sm" onClick={() => setForm({ open: true, dept: null })}><Plus /> Add department</Button>}
          mobileCard={(d) => (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{d.name}</span><Chip>{d.costCentre}</Chip></div>
              <div className="text-xs text-muted-foreground">{d.head} · {d.headcount} staff · {d.users} system users</div>
            </div>
          )}
        />
        <Panel title="Headcount distribution" description={`${totalHeadcount} people across ${rows.length} departments`} className="self-start">
          <BarList items={[...rows].sort((a, b) => b.headcount - a.headcount).map((d) => ({ label: d.name, value: d.headcount }))} />
        </Panel>
      </div>
      <DepartmentFormDialog open={form.open} dept={form.dept} onOpenChange={(o) => !o && setForm((f) => ({ ...f, open: false }))} />
    </div>
  )
}

function DepartmentFormDialog({ open, dept, onOpenChange }: { open: boolean; dept: Department | null; onOpenChange: (o: boolean) => void }) {
  const departments = useDb((s) => s.departments)
  const schema = React.useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, 'Enter the department name').max(60).refine((v) => !departments.some((d) => d.id !== dept?.id && d.name.toLowerCase() === v.toLowerCase()), 'A department with this name already exists'),
        head: z.string().trim().min(3, 'Enter the department head’s name'),
        headcount: z.number({ error: 'Enter the headcount' }).int('Whole people only').min(0, 'Cannot be negative').max(5000, 'Unrealistically high'),
        costCentre: z.string().trim().toUpperCase().regex(/^CC-\d{3}$/, 'Use the format CC-123').refine((v) => !departments.some((d) => d.id !== dept?.id && d.costCentre === v), 'This cost centre is already used'),
        description: z.string().trim().min(5, 'Add a short description').max(200),
      }),
    [departments, dept?.id],
  )
  const defaults = React.useMemo(() => (dept ? { name: dept.name, head: dept.head, headcount: dept.headcount, costCentre: dept.costCentre, description: dept.description } : { name: '', head: '', headcount: 0, costCentre: `CC-${String(Math.max(0, ...departments.map((d) => Number(d.costCentre.replace(/\D/g, '')) || 0)) + 100).padStart(3, '0')}`, description: '' }), [dept, open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={dept ? `Edit ${dept.name}` : 'Add department'}
      description="Departments group staff and cost centres for reporting."
      schema={schema}
      defaultValues={defaults}
      submitLabel={dept ? 'Save changes' : 'Add department'}
      onSubmit={(v) => {
        const db = useDb.getState()
        if (dept) {
          db.update('departments', dept.id, v, { summary: `Updated department ${v.name}` })
          toast.success(`${v.name} updated`)
        } else {
          db.insert('departments', v, { summary: `Created department ${v.name} (${v.costCentre})` })
          toast.success(`${v.name} added`)
        }
      }}
    >
      {(form) => (
        <>
          <FormGrid>
            <TextField form={form} name="name" label="Department name" required className="sm:col-span-2" />
            <TextField form={form} name="head" label="Department head" required />
            <TextField form={form} name="costCentre" label="Cost centre" required placeholder="CC-800" />
            <NumberField form={form} name="headcount" label="Headcount" required min={0} step={1} suffix="people" />
          </FormGrid>
          <TextAreaField form={form} name="description" label="Description" required rows={3} />
        </>
      )}
    </FormDialog>
  )
}

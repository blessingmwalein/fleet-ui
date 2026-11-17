import { useEffect, useMemo } from 'react'
import { endOfDay } from 'date-fns'
import { toast } from 'sonner'
import { z } from 'zod'
import type { Expense, ExpenseCategory } from '@/types'
import { useDb, db as getDb } from '@/store/db'
import { useActorName } from './hooks'
import { useBranchScope } from '@/hooks/useFilters'
import { useDriverOptions, useVehicleOptions, useBranchOptions } from '@/hooks/useOptions'
import { getById } from '@/hooks/useLookup'
import { EXPENSE_CATEGORY } from '@/config/status'
import { fmtUsd } from '@/lib/format'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, FormSection, NumberField, SelectField, TextField, fromInputDate, toInputDate, type AnyForm } from '@/components/forms/fields'

const CATS = Object.keys(EXPENSE_CATEGORY) as [ExpenseCategory, ...ExpenseCategory[]]
const METHODS = [
  { value: 'cash', label: 'Cash' }, { value: 'fuel_card', label: 'Fuel card' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'ecocash', label: 'EcoCash' }, { value: 'card', label: 'Company card' },
]

const schema = z
  .object({
    category: z.enum(CATS, { error: 'Select a category' }),
    description: z.string().trim().min(3, 'Describe the expense (at least 3 characters)').max(160, 'Keep the description under 160 characters'),
    amountUsd: z.number({ error: 'Enter the amount in USD' }).positive('Amount must be greater than zero').max(250000, 'Amount looks too large — check the figure'),
    date: z.string().min(1, 'Pick the expense date'),
    vehicleId: z.string().optional(),
    tripId: z.string().optional(),
    driverId: z.string().optional(),
    branchId: z.string().min(1, 'Select the branch that bears this cost'),
    supplier: z.string().trim().min(2, 'Enter the supplier or payee'),
    paymentMethod: z.enum(['cash', 'fuel_card', 'bank_transfer', 'ecocash', 'card'], { error: 'Select a payment method' }),
    receiptNo: z.string().trim().optional(),
  })
  .refine((v) => v.amountUsd < 100 || !!v.receiptNo, { path: ['receiptNo'], message: 'A receipt number is required for claims of $100 or more' })
  .refine((v) => !v.date || new Date(`${v.date}T00:00:00`) <= endOfDay(new Date()), { path: ['date'], message: 'The expense date cannot be in the future' })
  .refine(
    (v) => {
      if (!v.tripId || !v.vehicleId) return true
      const t = getById('trips', v.tripId)
      return !t?.vehicleId || t.vehicleId === v.vehicleId
    },
    { path: ['tripId'], message: 'This trip was run by a different vehicle' },
  )

function Fields({ form }: { form: AnyForm }) {
  const vehicleOptions = useVehicleOptions()
  const driverOptions = useDriverOptions()
  const branchOptions = useBranchOptions()
  const trips = useDb((s) => s.trips)
  const vehicleId = form.watch('vehicleId') as string | undefined
  const tripId = form.watch('tripId') as string | undefined

  const tripOptions = useMemo(
    () =>
      trips
        .filter((t) => t.status !== 'cancelled' && t.status !== 'scheduled' && t.status !== 'awaiting_assignment' && t.status !== 'ready' && (!vehicleId || t.vehicleId === vehicleId))
        .sort((a, b) => (b.actualStart ?? b.scheduledStart).localeCompare(a.actualStart ?? a.scheduledStart))
        .slice(0, 150)
        .map((t) => ({ value: t.id, label: t.ref, hint: `${t.origin.city} → ${t.destination.city}` })),
    [trips, vehicleId],
  )

  useEffect(() => {
    if (!vehicleId) return
    const v = getById('vehicles', vehicleId)
    if (!v) return
    if (!form.getValues('driverId') && v.driverId) form.setValue('driverId', v.driverId)
    if (!form.getValues('tripId')) form.setValue('branchId', v.branchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId])

  useEffect(() => {
    if (!tripId) return
    const t = getById('trips', tripId)
    if (!t) return
    if (!form.getValues('vehicleId') && t.vehicleId) form.setValue('vehicleId', t.vehicleId)
    if (!form.getValues('driverId') && t.driverId) form.setValue('driverId', t.driverId)
    form.setValue('branchId', t.branchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  return (
    <>
      <FormSection title="Expense details">
        <FormGrid>
          <SelectField form={form} name="category" label="Category" required options={CATS.map((c) => ({ value: c, label: EXPENSE_CATEGORY[c] }))} />
          <NumberField form={form} name="amountUsd" label="Amount (USD)" required prefix="$" min={0} step="0.01" hint="Captured in USD; shown in your display currency." />
        </FormGrid>
        <TextField form={form} name="description" label="Description" required placeholder="e.g. Toll fees – A1 Harare to Beitbridge" />
        <FormGrid>
          <DateField form={form} name="date" label="Expense date" required />
          <TextField form={form} name="supplier" label="Supplier / payee" required placeholder="e.g. ZINARA Toll" />
        </FormGrid>
      </FormSection>
      <FormSection title="Links" description="Attach the cost to a vehicle and trip for profitability reporting">
        <FormGrid>
          <ComboField form={form} name="vehicleId" label="Vehicle" options={vehicleOptions} placeholder="Select vehicle" searchPlaceholder="Search registration…" clearable />
          <ComboField form={form} name="tripId" label="Trip" options={tripOptions} placeholder={vehicleId ? 'Trips for this vehicle' : 'Select trip'} searchPlaceholder="Search trip ref or city…" clearable hint={vehicleId ? undefined : 'Picking a trip fills vehicle, driver and branch.'} />
          <ComboField form={form} name="driverId" label="Driver" options={driverOptions} placeholder="Select driver" searchPlaceholder="Search drivers…" clearable />
          <SelectField form={form} name="branchId" label="Branch" required options={branchOptions.map((b) => ({ value: b.value, label: b.label }))} />
        </FormGrid>
      </FormSection>
      <FormSection title="Payment">
        <FormGrid>
          <SelectField form={form} name="paymentMethod" label="Payment method" required options={METHODS} />
          <TextField form={form} name="receiptNo" label="Receipt no." placeholder="e.g. RC482913" />
        </FormGrid>
      </FormSection>
    </>
  )
}

/** Submit / edit an expense claim. Rejected claims that are edited are resubmitted as pending. */
export function ExpenseFormDialog({ open, onOpenChange, expense, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; expense?: Expense | null; onSaved?: (e: Expense) => void }) {
  const actor = useActorName()
  const { branchId } = useBranchScope()
  const editing = !!expense
  const defaults = useMemo(
    () =>
      expense
        ? { category: expense.category, description: expense.description, amountUsd: expense.amountUsd, date: toInputDate(expense.date), vehicleId: expense.vehicleId ?? '', tripId: expense.tripId ?? '', driverId: expense.driverId ?? '', branchId: expense.branchId, supplier: expense.supplier, paymentMethod: expense.paymentMethod, receiptNo: expense.receiptNo ?? '' }
        : { category: '' as ExpenseCategory, description: '', amountUsd: undefined as unknown as number, date: toInputDate(new Date().toISOString()), vehicleId: '', tripId: '', driverId: '', branchId: branchId === 'all' ? 'br-hre' : branchId, supplier: '', paymentMethod: 'cash' as const, receiptNo: '' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expense, open],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? (expense!.status === 'rejected' ? `Resubmit ${expense!.ref}` : `Edit ${expense!.ref}`) : 'Submit expense'}
      description={editing ? 'Update the claim details.' : 'Claim a trip or fleet expense. It enters the approval queue as pending.'}
      schema={schema}
      defaultValues={defaults}
      submitLabel={editing ? (expense!.status === 'rejected' ? 'Resubmit for approval' : 'Save changes') : 'Submit expense'}
      onSubmit={(v) => {
        const fields = {
          category: v.category, description: v.description, amountUsd: Math.round(v.amountUsd * 100) / 100, date: fromInputDate(v.date),
          vehicleId: v.vehicleId || null, tripId: v.tripId || null, driverId: v.driverId || null, branchId: v.branchId, supplier: v.supplier,
          paymentMethod: v.paymentMethod, receiptNo: v.receiptNo || undefined,
        }
        const db = getDb()
        if (expense) {
          db.update('expenses', expense.id, { ...fields, ...(expense.status === 'rejected' ? { status: 'pending' as const, rejectionReason: undefined, approvedBy: undefined } : {}) }, { summary: `Updated expense ${expense.ref} (${fmtUsd(fields.amountUsd, { digits: 2 })})` })
          toast.success(expense.status === 'rejected' ? `${expense.ref} resubmitted for approval` : `${expense.ref} updated`)
          onSaved?.({ ...expense, ...fields })
        } else {
          const n = db.expenses.reduce((m, e) => Math.max(m, Number(/(\d+)$/.exec(e.ref)?.[1] ?? 0)), 7000) + 1
          const created = db.insert('expenses', { ...fields, ref: `EXP-${n}`, status: 'pending', submittedBy: actor }, { summary: `Submitted expense EXP-${n} (${fmtUsd(fields.amountUsd, { digits: 2 })} – ${v.description})` })
          toast.success(`Expense ${created.ref} submitted`, { description: 'Awaiting approval' })
          onSaved?.(created)
        }
      }}
    >
      {(form) => <Fields form={form} />}
    </FormDialog>
  )
}

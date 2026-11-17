import { useEffect, useMemo } from 'react'
import { addDays, endOfDay } from 'date-fns'
import { toast } from 'sonner'
import { z } from 'zod'
import type { Invoice } from '@/types'
import { db as getDb, useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { can } from '@/hooks/useAuth'
import { getById } from '@/hooks/useLookup'
import { useBranchOptions, useCustomerOptions } from '@/hooks/useOptions'
import { useMoney } from '@/hooks/useMoney'
import { fmtDate, fmtUsd } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/form-controls'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, Field, FormGrid, FormSection, NumberField, SelectField, SwitchField, TextAreaField, TextField, fromInputDate, toInputDate, type AnyForm } from '@/components/forms/fields'
import { Badge } from '@/components/ui/display'
import { cn } from '@/lib/utils'
import { invoiceBalance, issueTimestamp, nextInvoiceNumber, PAYMENT_METHODS, round2, unbilledTrips } from './lib'

const noun = (n: number) => `${n} invoice${n === 1 ? '' : 's'}`
const today = () => toInputDate(new Date().toISOString())

/* ------------------------------------------------------------------ operations */
export function applyPayment(id: string, p: { amountUsd: number; date: string; method: string; ref: string }) {
  const inv = getById('invoices', id)
  if (!inv) return
  const paid = Math.min(inv.amountUsd, round2(inv.paidUsd + p.amountUsd))
  const status: Invoice['status'] = paid >= inv.amountUsd - 0.005 ? 'paid' : 'partial'
  getDb().update(
    'invoices', id,
    { paidUsd: paid, status, paymentRef: p.ref, payments: [...inv.payments, { date: p.date, amountUsd: p.amountUsd, method: p.method, ref: p.ref }] },
    { action: 'status', summary: `Recorded ${inv.kind === 'customer' ? 'receipt' : 'payment'} of ${fmtUsd(p.amountUsd, { digits: 2 })} on ${inv.number} (${status === 'paid' ? 'settled' : 'partially paid'})` },
  )
}

export function useInvoiceActions() {
  return useMemo(() => {
    const guard = (perm: 'finance.edit' | 'finance.approve' | 'finance.delete') => {
      if (can(perm)) return true
      toast.error('Your role does not have permission for this action')
      return false
    }
    /** Customer: send to customer. Supplier: approve for payment. Both move draft → sent. */
    async function release(rows: Invoice[]) {
      const eligible = rows.filter((i) => i.status === 'draft')
      if (!eligible.length) {
        toast.info('Only draft invoices can be sent / approved')
        return 0
      }
      const supplier = eligible[0]!.kind === 'supplier'
      if (!guard(supplier ? 'finance.approve' : 'finance.edit')) return 0
      const total = eligible.reduce((s, i) => s + i.amountUsd, 0)
      const ok = await confirm({
        title: supplier ? `Approve ${noun(eligible.length)} for payment?` : `Send ${noun(eligible.length)} to customers?`,
        description: `${fmtUsd(total, { digits: 2 })} will be ${supplier ? 'queued as payable' : 'marked as sent and counted in receivables'}.`,
        confirmLabel: supplier ? 'Approve' : 'Send',
      })
      if (!ok) return 0
      getDb().updateMany('invoices', eligible.map((i) => i.id), { status: 'sent' }, { action: supplier ? 'approve' : 'status', summary: supplier ? `Approved ${eligible.length} supplier invoice(s) for payment` : `Sent ${eligible.length} customer invoice(s)` })
      toast.success(supplier ? `${noun(eligible.length)} approved for payment` : `${noun(eligible.length)} sent`)
      return eligible.length
    }
    async function remove(rows: Invoice[]) {
      if (!guard('finance.delete')) return 0
      const eligible = rows.filter((i) => i.status === 'draft' && i.paidUsd === 0)
      if (!eligible.length) {
        toast.info('Only unpaid draft invoices can be deleted')
        return 0
      }
      const ok = await confirm({ title: `Delete ${noun(eligible.length)}?`, description: 'Draft invoices are removed permanently; linked trips become billable again.', confirmLabel: 'Delete', destructive: true })
      if (!ok) return 0
      if (eligible.length === 1) getDb().remove('invoices', eligible[0]!.id)
      else getDb().removeMany('invoices', eligible.map((i) => i.id))
      toast.success(`Deleted ${noun(eligible.length)}`)
      return eligible.length
    }
    return { release, remove }
  }, [])
}

/* ------------------------------------------------------------------ record payment */
export function PaymentDialog({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const money = useMoney()
  const balance = invoice ? invoiceBalance(invoice) : 0
  const customer = invoice?.kind === 'customer'
  const schema = useMemo(
    () =>
      z.object({
        amountUsd: z.number({ error: 'Enter the amount' }).positive('Amount must be greater than zero').max(Math.max(balance, 0.01), `Cannot exceed the outstanding balance of ${fmtUsd(balance, { digits: 2 })}`),
        date: z.string().min(1, 'Pick the payment date').refine((d) => new Date(`${d}T00:00:00`) <= endOfDay(new Date()), 'Payment date cannot be in the future'),
        method: z.string().min(1, 'Select a method'),
        ref: z.string().trim().min(3, 'Enter the payment reference (min 3 characters)'),
      }),
    [balance],
  )
  return (
    <FormDialog
      open={!!invoice}
      onOpenChange={(o) => !o && onClose()}
      title={customer ? 'Record customer receipt' : 'Record supplier payment'}
      description={invoice ? `${invoice.number} · ${invoice.partyName} · balance ${money(balance, { digits: 2 })}` : undefined}
      schema={schema}
      defaultValues={{ amountUsd: balance, date: today(), method: 'Bank transfer', ref: '' }}
      submitLabel="Record payment"
      onSubmit={(v) => {
        if (!invoice) return
        applyPayment(invoice.id, { amountUsd: round2(v.amountUsd), date: fromInputDate(v.date), method: v.method, ref: v.ref })
        toast.success(`${fmtUsd(v.amountUsd, { digits: 2 })} recorded on ${invoice.number}`)
      }}
    >
      {(form) => (
        <>
          <FormGrid>
            <NumberField form={form} name="amountUsd" label="Amount (USD)" required prefix="$" min={0} step="0.01" hint={`Outstanding ${money(balance, { digits: 2 })}`} />
            <DateField form={form} name="date" label="Payment date" required />
            <SelectField form={form} name="method" label="Method" required options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
            <TextField form={form} name="ref" label="Reference" required placeholder="e.g. RTGS-482913" />
          </FormGrid>
          <Button type="button" size="xs" variant="outline" onClick={() => form.setValue('amountUsd', balance, { shouldValidate: true })}>Pay full balance</Button>
        </>
      )}
    </FormDialog>
  )
}

/** Payment run: settle several invoices in full with one method/reference. */
export function BulkPaymentDialog({ invoices, onClose, onDone }: { invoices: Invoice[] | null; onClose: () => void; onDone?: () => void }) {
  const list = (invoices ?? []).filter((i) => i.status !== 'draft' && invoiceBalance(i) > 0)
  const total = list.reduce((s, i) => s + invoiceBalance(i), 0)
  const customer = list[0]?.kind === 'customer'
  const schema = useMemo(
    () => z.object({ date: z.string().min(1, 'Pick the date'), method: z.string().min(1, 'Select a method'), ref: z.string().trim().min(3, 'Enter a batch reference') }),
    [],
  )
  return (
    <FormDialog
      open={!!invoices}
      onOpenChange={(o) => !o && onClose()}
      title={customer ? 'Record receipts in full' : 'Payment run'}
      description={`${noun(list.length)} · ${fmtUsd(total, { digits: 2 })} settled in full`}
      schema={schema}
      defaultValues={{ date: today(), method: 'Bank transfer', ref: `BATCH-${Math.floor(100000 + Math.random() * 899999)}` }}
      submitLabel={`Settle ${noun(list.length)}`}
      onSubmit={(v) => {
        if (!list.length) throw new Error('None of the selected invoices has an outstanding balance')
        const date = fromInputDate(v.date)
        for (const inv of list) applyPayment(inv.id, { amountUsd: invoiceBalance(inv), date, method: v.method, ref: v.ref })
        toast.success(`${noun(list.length)} settled`, { description: fmtUsd(total, { digits: 2 }) })
        onDone?.()
      }}
    >
      {(form) => (
        <FormGrid cols={1}>
          <DateField form={form} name="date" label="Payment date" required />
          <SelectField form={form} name="method" label="Method" required options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
          <TextField form={form} name="ref" label="Batch reference" required />
        </FormGrid>
      )}
    </FormDialog>
  )
}

/* ------------------------------------------------------------------ customer invoice from trips */
const customerSchema = z
  .object({
    customerId: z.string().min(1, 'Select a customer'),
    tripIds: z.array(z.string()).min(1, 'Select at least one delivered trip to bill'),
    adjustment: z.number().optional(),
    issueDate: z.string().min(1, 'Pick the issue date'),
    termsDays: z.number({ error: 'Enter payment terms in days' }).int('Whole days only').min(0, 'Terms cannot be negative').max(180, 'Terms are capped at 180 days'),
    description: z.string().trim().min(3, 'Add a short description').max(200),
    sendNow: z.boolean(),
  })
  .refine((v) => new Date(`${v.issueDate}T00:00:00`) <= endOfDay(new Date()), { path: ['issueDate'], message: 'Issue date cannot be in the future' })
  .refine(
    (v) => {
      const latest = Math.max(0, ...v.tripIds.map((id) => new Date(getById('trips', id)?.actualEnd ?? 0).getTime()))
      return !latest || endOfDay(new Date(`${v.issueDate}T00:00:00`)).getTime() >= latest
    },
    { path: ['issueDate'], message: 'Issue date is earlier than the latest delivery on the selected trips' },
  )
  .refine((v) => v.tripIds.reduce((s, id) => s + (getById('trips', id)?.revenueUsd ?? 0), 0) + (v.adjustment ?? 0) > 0, { path: ['adjustment'], message: 'Invoice total must be greater than zero' })

function TripPicker({ form }: { form: AnyForm }) {
  const money = useMoney()
  const trips = useDb((s) => s.trips)
  const invoices = useDb((s) => s.invoices)
  const customerId = form.watch('customerId') as string
  const selected = (form.watch('tripIds') as string[]) ?? []
  const adjustment = (form.watch('adjustment') as number | undefined) ?? 0
  const issueDate = form.watch('issueDate') as string
  const terms = (form.watch('termsDays') as number | undefined) ?? 0
  const available = useMemo(() => (customerId ? unbilledTrips(trips, invoices, customerId) : []), [trips, invoices, customerId])
  const customer = getById('customers', customerId)
  const outstanding = useMemo(() => invoices.filter((i) => i.kind === 'customer' && i.partyId === customerId && i.status !== 'draft').reduce((s, i) => s + invoiceBalance(i), 0), [invoices, customerId])
  const subtotal = available.filter((t) => selected.includes(t.id)).reduce((s, t) => s + t.revenueUsd, 0)
  const total = subtotal + adjustment
  const due = issueDate ? addDays(new Date(`${issueDate}T00:00:00`), terms) : null

  useEffect(() => {
    form.setValue('tripIds', [])
    if (customer) form.setValue('termsDays', customer.paymentTermsDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  useEffect(() => {
    if (!selected.length || form.getFieldState('description').isDirty) return
    const refs = available.filter((t) => selected.includes(t.id)).map((t) => t.ref)
    form.setValue('description', `Freight services – ${selected.length} trip${selected.length === 1 ? '' : 's'} (${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` +${refs.length - 3} more` : ''})`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.length])

  const toggle = (id: string) => form.setValue('tripIds', selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], { shouldValidate: form.formState.isSubmitted })
  const error = form.getFieldState('tripIds', form.formState).error?.message as string | undefined
  const allSelected = available.length > 0 && selected.length === available.length

  return (
    <div className="space-y-3">
      <Field label="Delivered trips to bill" required error={error} hint={customerId ? undefined : 'Select a customer to list their unbilled deliveries.'}>
        <div className={cn('overflow-hidden rounded-md border border-border', error && 'border-danger')}>
          {customerId && available.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-xs font-medium">
              <Checkbox checked={allSelected ? true : selected.length ? 'indeterminate' : false} onCheckedChange={(v) => form.setValue('tripIds', v ? available.map((t) => t.id) : [], { shouldValidate: form.formState.isSubmitted })} />
              Select all ({available.length})
              <span className="num ml-auto text-muted-foreground">{money(subtotal, { digits: 2 })} selected</span>
            </label>
          )}
          <div className="max-h-56 overflow-y-auto">
            {!customerId ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">No customer selected</p>
            ) : available.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">All delivered trips for this customer are already invoiced.</p>
            ) : (
              available.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 py-1.5 text-[13px] last:border-0 hover:bg-accent/40">
                  <Checkbox checked={selected.includes(t.id)} onCheckedChange={() => toggle(t.id)} />
                  <span className="font-mono text-xs">{t.ref}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.origin.city} → {t.destination.city}</span>
                  <span className="hidden text-xs text-subtle-foreground sm:inline">{fmtDate(t.actualEnd)}</span>
                  <span className="num w-20 text-right font-medium">{money(t.revenueUsd, { digits: 2 })}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </Field>
      {customer && (customer.status !== 'active' || (customer.creditLimitUsd > 0 && outstanding + total > customer.creditLimitUsd)) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {customer.status !== 'active' && <Badge tone="warning">Account {customer.status.replace('_', ' ')}</Badge>}
          {customer.creditLimitUsd > 0 && outstanding + total > customer.creditLimitUsd && <span>Exposure {money(outstanding + total)} would exceed the credit limit of {money(customer.creditLimitUsd)}.</span>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-surface-2/50 p-3 text-center">
        <div><div className="label-xs">Subtotal</div><div className="num text-[15px] font-semibold">{money(subtotal, { digits: 2 })}</div><div className="text-[11px] text-subtle-foreground">{selected.length} trip{selected.length === 1 ? '' : 's'}</div></div>
        <div><div className="label-xs">Invoice total</div><div className="num text-[15px] font-semibold text-primary">{money(total, { digits: 2 })}</div><div className="text-[11px] text-subtle-foreground">{adjustment ? `incl. ${money(adjustment, { digits: 2 })} adj.` : 'auto-summed'}</div></div>
        <div><div className="label-xs">Due date</div><div className="num text-[15px] font-semibold">{due ? fmtDate(due) : '—'}</div><div className="text-[11px] text-subtle-foreground">Net {terms} days</div></div>
      </div>
    </div>
  )
}

export function CustomerInvoiceDialog({ open, onOpenChange, onCreated, customerId }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (i: Invoice) => void; customerId?: string }) {
  const customerOptions = useCustomerOptions()
  const trips = useDb((s) => s.trips)
  const invoices = useDb((s) => s.invoices)
  const money = useMoney()
  const options = useMemo(() => customerOptions.map((o) => {
    const unbilled = unbilledTrips(trips, invoices, o.value)
    return { ...o, hint: unbilled.length ? `${unbilled.length} unbilled · ${money(unbilled.reduce((s, t) => s + t.revenueUsd, 0))}` : 'nothing to bill' }
  }), [customerOptions, trips, invoices, money])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      size="lg"
      title="New customer invoice"
      description="Bill a customer for delivered trips. The amount is summed from the selected trips and the due date follows their payment terms."
      schema={customerSchema}
      defaultValues={{ customerId: customerId ?? '', tripIds: [] as string[], adjustment: undefined as unknown as number, issueDate: today(), termsDays: 30, description: '', sendNow: true }}
      submitLabel="Create invoice"
      onSubmit={(v) => {
        const picked = v.tripIds.map((id) => getById('trips', id)).filter((t): t is NonNullable<typeof t> => !!t)
        const customer = getById('customers', v.customerId)
        if (!customer || !picked.length) throw new Error('Select a customer and at least one trip')
        const issue = issueTimestamp(new Date(`${v.issueDate}T00:00:00`))
        const counts = new Map<string, number>()
        for (const t of picked) counts.set(t.branchId, (counts.get(t.branchId) ?? 0) + 1)
        const branchId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        const amount = round2(picked.reduce((s, t) => s + t.revenueUsd, 0) + (v.adjustment ?? 0))
        const number = nextInvoiceNumber(getDb().invoices, 'customer', issue)
        const created = getDb().insert('invoices', {
          number, kind: 'customer', partyId: customer.id, partyName: customer.name, description: v.description, amountUsd: amount, paidUsd: 0,
          issueDate: issue.toISOString(), dueDate: addDays(issue, v.termsDays).toISOString(), status: v.sendNow ? 'sent' : 'draft', tripIds: picked.map((t) => t.id), branchId, payments: [],
        }, { summary: `Issued customer invoice ${number} to ${customer.name} (${fmtUsd(amount, { digits: 2 })}, ${picked.length} trips)` })
        toast.success(`Invoice ${number} ${v.sendNow ? 'created and sent' : 'saved as draft'}`, { description: `${customer.name} · ${fmtUsd(amount, { digits: 2 })}` })
        onCreated?.(created)
      }}
    >
      {(form) => (
        <>
          <FormSection title="Customer">
            <ComboField form={form} name="customerId" label="Customer" required options={options} placeholder="Select customer" searchPlaceholder="Search customers…" />
          </FormSection>
          <FormSection title="Trips">
            <TripPicker form={form} />
          </FormSection>
          <FormSection title="Terms">
            <FormGrid cols={3}>
              <DateField form={form} name="issueDate" label="Issue date" required />
              <NumberField form={form} name="termsDays" label="Payment terms" required suffix="days" min={0} step={1} />
              <NumberField form={form} name="adjustment" label="Adjustment" prefix="$" step="0.01" hint="Surcharge (+) or discount (−)" />
            </FormGrid>
            <TextAreaField form={form} name="description" label="Description" required rows={2} />
            <SwitchField form={form} name="sendNow" label="Mark as sent" hint="Off saves a draft that is not yet counted in receivables." />
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

/* ------------------------------------------------------------------ supplier invoice */
const supplierSchema = z
  .object({
    partyName: z.string().trim().min(2, 'Enter the supplier name'),
    number: z.string().trim().min(3, 'Enter the invoice number'),
    description: z.string().trim().min(3, 'Add a short description').max(200),
    amountUsd: z.number({ error: 'Enter the invoice amount' }).positive('Amount must be greater than zero').max(5_000_000, 'Amount looks too large'),
    issueDate: z.string().min(1, 'Pick the invoice date'),
    dueDate: z.string().min(1, 'Pick the due date'),
    branchId: z.string().min(1, 'Select a branch'),
    status: z.enum(['draft', 'sent'], { error: 'Select a status' }),
  })
  .refine((v) => !v.issueDate || !v.dueDate || v.dueDate >= v.issueDate, { path: ['dueDate'], message: 'Due date cannot be before the invoice date' })
  .refine((v) => !getDb().invoices.some((i) => i.kind === 'supplier' && i.number.toLowerCase() === v.number.toLowerCase()), { path: ['number'], message: 'An invoice with this number already exists' })

export function SupplierInvoiceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (i: Invoice) => void }) {
  const invoices = useDb((s) => s.invoices)
  const branchOptions = useBranchOptions()
  const suppliers = useMemo(() => [...new Set(invoices.filter((i) => i.kind === 'supplier').map((i) => i.partyName))].sort(), [invoices])
  const defaults = useMemo(
    () => ({ partyName: '', number: nextInvoiceNumber(invoices, 'supplier'), description: '', amountUsd: undefined as unknown as number, issueDate: today(), dueDate: toInputDate(addDays(new Date(), 30).toISOString()), branchId: 'br-hre', status: 'draft' as const }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Record supplier invoice"
      description="Capture a bill from a fuel supplier, workshop, insurer or other vendor for approval and payment."
      schema={supplierSchema}
      defaultValues={defaults}
      submitLabel="Save invoice"
      onSubmit={(v) => {
        const created = getDb().insert('invoices', {
          number: v.number, kind: 'supplier', partyId: null, partyName: v.partyName, description: v.description, amountUsd: round2(v.amountUsd), paidUsd: 0,
          issueDate: fromInputDate(v.issueDate), dueDate: fromInputDate(v.dueDate), status: v.status, tripIds: [], branchId: v.branchId, payments: [],
        }, { summary: `Recorded supplier invoice ${v.number} from ${v.partyName} (${fmtUsd(v.amountUsd, { digits: 2 })})` })
        toast.success(`Supplier invoice ${v.number} recorded`, { description: `${v.partyName} · ${fmtUsd(v.amountUsd, { digits: 2 })}` })
        onCreated?.(created)
      }}
    >
      {(form) => (
        <>
          <FormGrid>
            <Field label="Supplier" required error={form.getFieldState('partyName', form.formState).error?.message}>
              <Input list="fin-suppliers" placeholder="Start typing a supplier…" aria-invalid={!!form.getFieldState('partyName', form.formState).error} {...form.register('partyName')} />
              <datalist id="fin-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <TextField form={form} name="number" label="Invoice number" required />
          </FormGrid>
          <TextField form={form} name="description" label="Description" required placeholder="e.g. Workshop services – November 2026" />
          <FormGrid>
            <NumberField form={form} name="amountUsd" label="Amount (USD)" required prefix="$" min={0} step="0.01" />
            <SelectField form={form} name="branchId" label="Branch" required options={branchOptions.map((b) => ({ value: b.value, label: b.label }))} />
            <DateField form={form} name="issueDate" label="Invoice date" required />
            <DateField form={form} name="dueDate" label="Due date" required />
          </FormGrid>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Terms:
            {[7, 14, 30, 45, 60].map((n) => (
              <Button key={n} type="button" size="xs" variant="outline" onClick={() => form.setValue('dueDate', toInputDate(addDays(new Date(`${form.getValues('issueDate') || today()}T00:00:00`), n).toISOString()), { shouldValidate: true })}>Net {n}</Button>
            ))}
          </div>
          <SelectField form={form} name="status" label="Initial status" required options={[{ value: 'draft', label: 'Pending approval' }, { value: 'sent', label: 'Approved – awaiting payment' }]} />
        </>
      )}
    </FormDialog>
  )
}

import { useMemo } from 'react'
import { z } from 'zod'
import { toast } from 'sonner'
import type { Customer } from '@/types'
import { useDb } from '@/store/db'
import { FormDialog } from '@/components/forms/FormDialog'
import { FormGrid, FormSection, NumberField, SelectField, TextAreaField, TextField } from '@/components/forms/fields'
import { navigateTo } from '@/lib/navigation'
import { CITY_OPTIONS, cityCoords } from './shipmentLib'

const EXTRA_INDUSTRIES = ['Retail', 'Mining', 'Agriculture', 'Construction', 'Food & Beverage', 'Manufacturing', 'Healthcare', 'Energy', 'Forestry', 'Telecoms', 'Education', 'Government', 'Other']
const TERMS = [7, 14, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `${d} days` }))
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'inactive', label: 'Inactive' }]

function makeSchema(self?: Customer) {
  return z
    .object({
      name: z.string().trim().min(2, 'Enter the customer / company name').max(80, 'Max 80 characters'),
      code: z.string().trim().min(2, 'Enter an account code').max(12, 'Max 12 characters').regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
      industry: z.string().min(1, 'Select an industry'),
      contactName: z.string().trim().min(2, 'Enter the primary contact').max(80),
      email: z.email('Enter a valid email address'),
      phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number'),
      city: z.string().min(1, 'Select a city or town'),
      address: z.string().trim().min(5, 'Enter the street address').max(160),
      creditLimitUsd: z.number({ error: 'Enter a credit limit' }).min(0, 'Cannot be negative').max(5_000_000, 'Limit looks too high'),
      paymentTermsDays: z.string().min(1, 'Select payment terms'),
      status: z.enum(['active', 'on_hold', 'inactive']),
    })
    .superRefine((v, ctx) => {
      const others = useDb.getState().customers.filter((c) => c.id !== self?.id)
      if (others.some((c) => c.name.toLowerCase() === v.name.trim().toLowerCase())) ctx.addIssue({ code: 'custom', path: ['name'], message: 'A customer with this name already exists' })
      if (others.some((c) => c.code.toLowerCase() === v.code.trim().toLowerCase())) ctx.addIssue({ code: 'custom', path: ['code'], message: 'This account code is already in use' })
    })
}

export function CustomerFormDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer }) {
  const customers = useDb((s) => s.customers)
  const schema = useMemo(() => makeSchema(customer), [customer])
  const industries = useMemo(() => [...new Set([...EXTRA_INDUSTRIES, ...customers.map((c) => c.industry)])].sort().map((v) => ({ value: v, label: v })), [customers])
  const nextCode = useMemo(() => `C${customers.reduce((m, c) => Math.max(m, Number(c.code.replace(/\D/g, '')) || 0), 1000) + 13}`, [customers])

  const defaults = useMemo(
    () =>
      customer
        ? { name: customer.name, code: customer.code, industry: customer.industry, contactName: customer.contactName, email: customer.email, phone: customer.phone, city: customer.city, address: customer.address, creditLimitUsd: customer.creditLimitUsd, paymentTermsDays: String(customer.paymentTermsDays), status: customer.status }
        : { name: '', code: nextCode, industry: '', contactName: '', email: '', phone: '', city: 'Harare', address: '', creditLimitUsd: 25000, paymentTermsDays: '30', status: 'active' as const },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customer, open],
  )

  const onSubmit = (v: z.output<typeof schema>) => {
    const db = useDb.getState()
    const base = { name: v.name.trim(), code: v.code.trim().toUpperCase(), industry: v.industry, contactName: v.contactName.trim(), email: v.email.trim().toLowerCase(), phone: v.phone.trim(), city: v.city, address: v.address.trim(), creditLimitUsd: v.creditLimitUsd, paymentTermsDays: Number(v.paymentTermsDays), status: v.status }
    if (customer) {
      const moved = customer.city !== v.city
      const c = cityCoords(v.city)
      db.update('customers', customer.id, { ...base, ...(moved ? { lat: c.lat + (Math.random() - 0.5) * 0.02, lng: c.lng + (Math.random() - 0.5) * 0.02 } : {}) }, { summary: `Updated customer ${base.name}` })
      toast.success(`${base.name} updated`)
      return
    }
    const c = cityCoords(v.city)
    const rec = db.insert('customers', { ...base, lat: c.lat + (Math.random() - 0.5) * 0.02, lng: c.lng + (Math.random() - 0.5) * 0.02, createdAt: new Date().toISOString() }, { summary: `Created customer ${base.name}` })
    toast.success(`Customer ${base.name} added`, { action: { label: 'Open', onClick: () => navigateTo(`/customers/${rec.id}`) } })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? `Edit ${customer.name}` : 'Add customer'}
      description={customer ? 'Update the account profile, contact and credit terms.' : 'Create a customer account so shipments and invoices can be raised against it.'}
      schema={schema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      submitLabel={customer ? 'Save changes' : 'Add customer'}
      size="lg"
    >
      {(form) => (
        <>
          <FormSection title="Company">
            <FormGrid>
              <TextField form={form} name="name" label="Customer / company name" required className="sm:col-span-2" />
              <TextField form={form} name="code" label="Account code" required hint="Unique, e.g. C1045" />
              <SelectField form={form} name="industry" label="Industry" required options={industries} placeholder="Select industry…" />
            </FormGrid>
          </FormSection>
          <FormSection title="Contact & location">
            <FormGrid>
              <TextField form={form} name="contactName" label="Primary contact" required />
              <TextField form={form} name="phone" label="Phone" required inputMode="tel" placeholder="+263 242 123 456" />
              <TextField form={form} name="email" label="Email" required type="email" className="sm:col-span-2" placeholder="name@company.co.zw" />
              <SelectField form={form} name="city" label="City / town" required options={CITY_OPTIONS} />
              <TextAreaField form={form} name="address" label="Street address" required rows={2} className="sm:col-span-2" />
            </FormGrid>
          </FormSection>
          <FormSection title="Credit & terms">
            <FormGrid cols={3}>
              <NumberField form={form} name="creditLimitUsd" label="Credit limit (USD)" required prefix="$" min={0} />
              <SelectField form={form} name="paymentTermsDays" label="Payment terms" required options={TERMS} />
              <SelectField form={form} name="status" label="Account status" required options={STATUS_OPTIONS} hint="On hold blocks new shipments" />
            </FormGrid>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

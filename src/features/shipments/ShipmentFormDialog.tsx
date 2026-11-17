import { useEffect, useMemo } from 'react'
import { useFormState, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, Info } from 'lucide-react'
import type { Place, Shipment } from '@/types'
import { useDb } from '@/store/db'
import { getById } from '@/hooks/useLookup'
import { useBranchScope } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, FormSection, NumberField, SelectField, TextAreaField, TextField, fromInputDate, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import type { ComboOption } from '@/components/ui/command'
import { CARGO_TYPE } from '@/config/status'
import { navigateTo } from '@/lib/navigation'
import { useCustomerStats } from './customerStats'
import { blankMilestones, CITY_OPTIONS, cityCoords, newTrackingRef } from './shipmentLib'

const CARGO_OPTIONS = Object.entries(CARGO_TYPE).filter(([k]) => k !== 'passengers').map(([value, label]) => ({ value, label }))
const U = undefined as unknown as number

function makeSchema(originalCustomerId?: string) {
  return z
    .object({
      customerId: z.string().min(1, 'Select a customer'),
      branchId: z.string().min(1, 'Select the originating depot'),
      cargoType: z.string().min(1, 'Select a cargo type'),
      cargoDescription: z.string().trim().min(3, 'Describe the cargo (min 3 characters)').max(120, 'Keep it under 120 characters'),
      weightKg: z.number({ error: 'Enter the cargo weight' }).positive('Weight must be greater than 0').max(60000, 'Exceeds the 60,000 kg legal maximum'),
      packages: z.number({ error: 'Enter the number of packages' }).int('Whole packages only').min(1, 'At least 1 package').max(100000, 'Too many packages'),
      declaredValueUsd: z.number({ error: 'Enter the declared value' }).min(0, 'Cannot be negative').max(10_000_000, 'Value looks too high'),
      chargeUsd: z.number({ error: 'Enter the freight charge' }).min(0, 'Cannot be negative').max(1_000_000, 'Charge looks too high'),
      pickupSite: z.string().min(1, 'Select a pickup site'),
      pickupName: z.string().optional(),
      pickupCity: z.string().optional(),
      deliverySite: z.string().min(1, 'Select a delivery site'),
      deliveryName: z.string().optional(),
      deliveryCity: z.string().optional(),
      pickupWindowStart: z.string().min(1, 'Pickup window is required'),
      deliveryEta: z.string().min(1, 'Delivery ETA is required'),
      contactName: z.string().trim().min(2, 'Enter the consignee contact').max(80),
      contactPhone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number'),
    })
    .superRefine((v, ctx) => {
      const cust = getById('customers', v.customerId)
      if (cust && cust.id !== originalCustomerId && cust.status !== 'active') ctx.addIssue({ code: 'custom', path: ['customerId'], message: cust.status === 'on_hold' ? 'This customer is on credit hold — release the hold first' : 'This customer is inactive' })
      for (const side of ['pickup', 'delivery'] as const) {
        if (v[`${side}Site`] === 'custom') {
          if (!v[`${side}Name`]?.trim()) ctx.addIssue({ code: 'custom', path: [`${side}Name`], message: 'Enter the address or place name' })
          if (!v[`${side}City`]) ctx.addIssue({ code: 'custom', path: [`${side}City`], message: 'Select the city or town' })
        }
      }
      if (v.pickupSite && v.pickupSite === v.deliverySite && v.pickupSite !== 'custom') ctx.addIssue({ code: 'custom', path: ['deliverySite'], message: 'Delivery site must differ from pickup' })
      if (v.pickupWindowStart && v.deliveryEta && new Date(v.deliveryEta) <= new Date(v.pickupWindowStart)) ctx.addIssue({ code: 'custom', path: ['deliveryEta'], message: 'ETA must be after the pickup window' })
    })
}
type FormValues = z.input<ReturnType<typeof makeSchema>>

/** Site picker options: customer sites, depots and a free-text option. */
function useSiteOptions(): ComboOption[] {
  const customers = useDb((s) => s.customers)
  const branches = useDb((s) => s.branches)
  return useMemo(
    () => [
      { value: 'custom', label: 'Other address…', hint: 'enter manually' },
      ...customers.map((c) => ({ value: `cust:${c.id}`, label: c.name, hint: c.city })),
      ...branches.filter((b) => b.type !== 'workshop').map((b) => ({ value: `branch:${b.id}`, label: `${b.name} (depot)`, hint: b.city })),
    ],
    [customers, branches],
  )
}

export function siteToPlace(site: string, name: string | undefined, city: string | undefined, existing?: Place): Place {
  if (site.startsWith('cust:')) {
    const c = getById('customers', site.slice(5))
    if (c) return { name: `${c.name} – ${c.city}`, city: c.city, lat: c.lat, lng: c.lng }
  }
  if (site.startsWith('branch:')) {
    const b = getById('branches', site.slice(7))
    if (b) return { name: b.name, city: b.city, lat: b.lat, lng: b.lng }
  }
  const nm = (name ?? '').trim()
  const ct = city ?? ''
  if (existing && existing.name === nm && existing.city === ct) return existing
  return { name: nm, city: ct, ...cityCoords(ct) }
}

export function placeToSite(p: Place): { site: string; name: string; city: string } {
  const { customers, branches } = useDb.getState()
  const c = customers.find((x) => `${x.name} – ${x.city}` === p.name)
  if (c) return { site: `cust:${c.id}`, name: '', city: '' }
  const b = branches.find((x) => x.name === p.name)
  if (b) return { site: `branch:${b.id}`, name: '', city: '' }
  return { site: 'custom', name: p.name, city: p.city }
}

function blankValues(customerId: string | undefined, branchId: string): FormValues {
  const cust = customerId ? getById('customers', customerId) : undefined
  const branches = useDb.getState().branches
  const start = new Date(Math.ceil((Date.now() + 4 * 36e5) / 36e5) * 36e5)
  const eta = new Date(start.getTime() + 24 * 36e5)
  const homeBranch = cust ? branches.find((b) => b.city === cust.city && b.type !== 'workshop')?.id : undefined
  return {
    customerId: cust?.id ?? '',
    branchId: homeBranch ?? (branchId !== 'all' ? branchId : 'br-hre'),
    cargoType: 'general',
    cargoDescription: '',
    weightKg: U,
    packages: U,
    declaredValueUsd: U,
    chargeUsd: U,
    pickupSite: cust ? `cust:${cust.id}` : '',
    pickupName: '',
    pickupCity: '',
    deliverySite: '',
    deliveryName: '',
    deliveryCity: '',
    pickupWindowStart: toInputDateTime(start.toISOString()),
    deliveryEta: toInputDateTime(eta.toISOString()),
    contactName: cust?.contactName ?? '',
    contactPhone: cust?.phone ?? '',
  }
}

function valuesFromShipment(s: Shipment): FormValues {
  const p = placeToSite(s.pickup)
  const d = placeToSite(s.delivery)
  return {
    customerId: s.customerId, branchId: s.branchId, cargoType: s.cargoType, cargoDescription: s.cargoDescription, weightKg: s.weightKg, packages: s.packages,
    declaredValueUsd: s.declaredValueUsd, chargeUsd: s.chargeUsd,
    pickupSite: p.site, pickupName: p.name, pickupCity: p.city, deliverySite: d.site, deliveryName: d.name, deliveryCity: d.city,
    pickupWindowStart: toInputDateTime(s.pickupWindowStart), deliveryEta: toInputDateTime(s.deliveryEta), contactName: s.contactName, contactPhone: s.contactPhone,
  }
}

function SiteFields({ form, side, label, options }: { form: AnyForm; side: 'pickup' | 'delivery'; label: string; options: ComboOption[] }) {
  const site = useWatch({ control: form.control, name: `${side}Site` })
  return (
    <div className="space-y-3">
      <ComboField form={form} name={`${side}Site`} label={label} required options={options} placeholder="Select a site…" searchPlaceholder="Search customers & depots…" />
      {site === 'custom' && (
        <FormGrid>
          <TextField form={form} name={`${side}Name`} label="Address / place name" required placeholder="e.g. 14 Lytton Rd, Workington" />
          <SelectField form={form} name={`${side}City`} label="City / town" required options={CITY_OPTIONS} placeholder="Select city…" />
        </FormGrid>
      )}
    </div>
  )
}

/** Autofills contact, pickup site and depot when the user picks a different customer (never on reset/edit load). */
function CustomerAutofill({ form }: { form: AnyForm }) {
  const customerId = useWatch({ control: form.control, name: 'customerId' }) as string
  const { dirtyFields } = useFormState({ control: form.control, name: 'customerId' })
  const branches = useDb((s) => s.branches)
  useEffect(() => {
    if (!customerId || !dirtyFields.customerId) return
    const c = getById('customers', customerId)
    if (!c) return
    form.setValue('contactName', c.contactName, { shouldDirty: true })
    form.setValue('contactPhone', c.phone, { shouldDirty: true })
    if (!form.getValues('pickupSite')) form.setValue('pickupSite', `cust:${c.id}`, { shouldDirty: true })
    const b = branches.find((x) => x.city === c.city && x.type !== 'workshop')
    if (b) form.setValue('branchId', b.id, { shouldDirty: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])
  return null
}

function CreditNote({ form }: { form: AnyForm }) {
  const customerId = useWatch({ control: form.control, name: 'customerId' }) as string
  const charge = (useWatch({ control: form.control, name: 'chargeUsd' }) as number | undefined) ?? 0
  const stats = useCustomerStats()
  const money = useMoney()
  const c = useDb((s) => s.customers.find((x) => x.id === customerId))
  if (!c) return null
  const st = stats.get(c.id)
  const out = st?.outstanding ?? 0
  const over = out + charge > c.creditLimitUsd
  const held = c.status !== 'active'
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${held || over ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border bg-surface-2/60 text-muted-foreground'}`}>
      {held || over ? <AlertTriangle className="mt-px size-3.5 shrink-0" /> : <Info className="mt-px size-3.5 shrink-0" />}
      <p>
        <span className="font-medium text-foreground">{c.name}</span> · {c.paymentTermsDays}-day terms · outstanding {money(out)} of {money(c.creditLimitUsd)} credit limit
        {charge > 0 && <> · this shipment adds {money(charge)}</>}
        {held && <> · <span className="font-medium">account is {c.status === 'on_hold' ? 'on credit hold' : 'inactive'}</span></>}
        {!held && over && <> · <span className="font-medium">would exceed the credit limit</span></>}
      </p>
    </div>
  )
}

export function ShipmentFormDialog({ open, onOpenChange, shipment, presetCustomerId }: { open: boolean; onOpenChange: (o: boolean) => void; shipment?: Shipment; presetCustomerId?: string }) {
  const { branchId: scopeBranch } = useBranchScope()
  const branchOptions = useDb((s) => s.branches).filter((b) => b.type !== 'workshop').map((b) => ({ value: b.id, label: `${b.name} · ${b.city}` }))
  const siteOptions = useSiteOptions()
  const customers = useDb((s) => s.customers)
  const customerOptions = useMemo<ComboOption[]>(
    () => customers.filter((c) => c.status === 'active' || c.id === shipment?.customerId || c.id === presetCustomerId).map((c) => ({ value: c.id, label: c.name, hint: c.status === 'active' ? c.city : c.status === 'on_hold' ? 'On hold' : 'Inactive' })).sort((a, b) => a.label.localeCompare(b.label)),
    [customers, shipment?.customerId, presetCustomerId],
  )
  const schema = useMemo(() => makeSchema(shipment?.customerId), [shipment?.customerId])
  const editing = !!shipment
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaults = useMemo(() => (shipment ? valuesFromShipment(shipment) : blankValues(presetCustomerId, scopeBranch)), [shipment, presetCustomerId, scopeBranch, open])

  const onSubmit = (v: z.output<typeof schema>) => {
    const db = useDb.getState()
    const pickup = siteToPlace(v.pickupSite, v.pickupName, v.pickupCity, shipment?.pickup)
    const delivery = siteToPlace(v.deliverySite, v.deliveryName, v.deliveryCity, shipment?.delivery)
    const customer = db.customers.find((c) => c.id === v.customerId)!
    const common = {
      customerId: v.customerId, branchId: v.branchId, cargoType: v.cargoType as Shipment['cargoType'], cargoDescription: v.cargoDescription.trim(), weightKg: v.weightKg, packages: v.packages,
      declaredValueUsd: v.declaredValueUsd, chargeUsd: v.chargeUsd, pickup, delivery, pickupWindowStart: fromInputDate(v.pickupWindowStart), deliveryEta: fromInputDate(v.deliveryEta),
      contactName: v.contactName.trim(), contactPhone: v.contactPhone.trim(),
    }
    if (shipment) {
      db.update('shipments', shipment.id, common, { summary: `Updated shipment ${shipment.trackingRef} (${customer.name})` })
      const trip = shipment.tripId ? db.trips.find((t) => t.id === shipment.tripId) : undefined
      if (trip && trip.status !== 'completed' && trip.status !== 'cancelled')
        db.update('trips', trip.id, { cargoType: common.cargoType, cargoDescription: common.cargoDescription, cargoWeightKg: v.weightKg, revenueUsd: v.chargeUsd, customerId: v.customerId }, { silent: true })
      toast.success(`Shipment ${shipment.trackingRef} updated`)
      return
    }
    const now = new Date().toISOString()
    const trackingRef = newTrackingRef(db.shipments)
    const rec = db.insert(
      'shipments',
      { ...common, trackingRef, tripId: null, vehicleId: null, driverId: null, status: 'registered', deliveredAt: null, milestones: blankMilestones(now), exception: null, pod: null, createdAt: now },
      { summary: `Registered shipment ${trackingRef} for ${customer.name}` },
    )
    toast.success(`Shipment ${trackingRef} registered`, { description: `${pickup.city} → ${delivery.city} · allocate a vehicle to dispatch it`, action: { label: 'Open', onClick: () => navigateTo(`/shipments/${rec.id}`) } })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit shipment ${shipment!.trackingRef}` : 'Register shipment'}
      description={editing ? 'Update cargo, route and commercial details.' : 'Book a new consignment. A tracking reference is generated automatically; allocate a vehicle afterwards.'}
      schema={schema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      submitLabel={editing ? 'Save changes' : 'Register shipment'}
      size="lg"
    >
      {(form) => (
        <>
          <CustomerAutofill form={form} />
          <FormSection title="Customer & booking">
            <FormGrid>
              <ComboField form={form} name="customerId" label="Customer" required options={customerOptions} placeholder="Select customer…" searchPlaceholder="Search customers…" />
              <SelectField form={form} name="branchId" label="Originating depot" required options={branchOptions} />
            </FormGrid>
            <CreditNote form={form} />
          </FormSection>

          <FormSection title="Cargo">
            <FormGrid>
              <SelectField form={form} name="cargoType" label="Cargo type" required options={CARGO_OPTIONS} />
              <TextAreaField form={form} name="cargoDescription" label="Description" required rows={2} placeholder="e.g. Assorted FMCG pallets" className="sm:col-span-2" />
              <NumberField form={form} name="weightKg" label="Weight" required suffix="kg" min={0} placeholder="0" />
              <NumberField form={form} name="packages" label="Packages" required min={1} step={1} placeholder="0" />
              <NumberField form={form} name="declaredValueUsd" label="Declared value (USD)" required min={0} prefix="$" placeholder="0" hint="Insured value of the goods" />
              <NumberField form={form} name="chargeUsd" label="Freight charge (USD)" required min={0} prefix="$" placeholder="0" hint="Billed to the customer" />
            </FormGrid>
          </FormSection>

          <FormSection title="Pickup & delivery" description="Pick a customer site / depot or enter an address">
            <SiteFields form={form} side="pickup" label="Pickup site" options={siteOptions} />
            <DateField form={form} name="pickupWindowStart" label="Pickup window starts" required withTime />
            <SiteFields form={form} side="delivery" label="Delivery site" options={siteOptions} />
            <DateField form={form} name="deliveryEta" label="Delivery ETA" required withTime />
          </FormSection>

          <FormSection title="Consignee contact">
            <FormGrid>
              <TextField form={form} name="contactName" label="Contact name" required />
              <TextField form={form} name="contactPhone" label="Contact phone" required inputMode="tel" placeholder="+263 242 123 456" />
            </FormGrid>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

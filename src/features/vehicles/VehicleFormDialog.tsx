import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { z } from 'zod'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'
import { useDb } from '@/store/db'
import { useBranchScope } from '@/hooks/useFilters'
import { useBranchOptions, CATEGORY_OPTIONS } from '@/hooks/useOptions'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, FormGrid, FormSection, NumberField, SelectField, TextAreaField, TextField, toInputDate } from '@/components/forms/fields'
import { expiryState } from '@/config/status'
import { FUEL_TYPE_OPTIONS, REG_RE, VEHICLE_CATEGORY_KEYS, normaliseReg } from './lib'
import { createVehicle, updateVehicle, assignDriver, type VehicleFormValues } from './actions'

const CURRENT_YEAR = new Date().getFullYear()

function makeSchema(takenRegs: Set<string>) {
  return z
    .object({
      reg: z
        .string()
        .trim()
        .min(1, 'Registration is required')
        .refine((v) => REG_RE.test(normaliseReg(v)), 'Use the format AAA 1234 (three letters, four digits)')
        .refine((v) => !takenRegs.has(normaliseReg(v)), 'This registration already exists in the fleet'),
      make: z.string().trim().min(2, 'Make is required'),
      model: z.string().trim().min(1, 'Model is required'),
      year: z.number({ error: 'Year is required' }).int('Enter a whole year').min(1990, 'Year must be 1990 or later').max(CURRENT_YEAR + 1, `Year can't be after ${CURRENT_YEAR + 1}`),
      category: z.enum(VEHICLE_CATEGORY_KEYS, { error: 'Select a category' }),
      colour: z.string().trim().min(2, 'Colour is required'),
      vin: z.string().trim().regex(/^[A-Za-z0-9]{17}$/, 'VIN must be exactly 17 letters / digits'),
      engineNo: z.string().trim().min(4, 'Engine number is required'),
      fuelType: z.enum(['diesel', 'petrol', 'lpg'], { error: 'Select a fuel type' }),
      tankCapacityL: z.number({ error: 'Tank capacity is required' }).min(5, 'At least 5 L').max(1500, 'At most 1,500 L'),
      loadCapacityKg: z.number({ error: 'Load capacity is required' }).min(10, 'At least 10 kg').max(60000, 'At most 60,000 kg'),
      seats: z.number({ error: 'Enter a number' }).int('Whole number').min(1, 'At least 1').max(90, 'At most 90').optional(),
      axles: z.number({ error: 'Axles is required' }).int('Whole number').min(2, 'At least 2').max(8, 'At most 8'),
      branchId: z.string().min(1, 'Select a branch'),
      odometerKm: z.number({ error: 'Odometer is required' }).min(0, 'Cannot be negative').max(3_000_000, 'Unrealistic odometer reading'),
      purchaseDate: z.string().min(1, 'Purchase date is required').refine((d) => new Date(d) <= new Date(), 'Purchase date cannot be in the future'),
      purchaseCostUsd: z.number({ error: 'Purchase cost is required' }).min(500, 'At least 500').max(1_000_000, 'At most 1,000,000'),
      deviceId: z.string().trim().regex(/^[A-Za-z0-9-]{4,24}$/, 'Use 4–24 letters, digits or dashes (e.g. GPS-482913)'),
      driverId: z.string().optional(),
      notes: z.string().max(500, 'Max 500 characters').optional(),
    })
    .refine((v) => v.category !== 'bus' || (v.seats ?? 0) >= 10, { message: 'Seat count is required for buses (min. 10)', path: ['seats'] })
}

type FormInput = z.input<ReturnType<typeof makeSchema>>

/** Register / edit vehicle. Shown as a right-hand sheet. */
export function VehicleFormDialog({ open, onOpenChange, vehicle, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle?: Vehicle; onCreated?: (v: Vehicle) => void }) {
  const navigate = useNavigate()
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branchOptions = useBranchOptions()
  const { branchId: scopedBranch } = useBranchScope()
  const editing = !!vehicle

  const taken = useMemo(() => new Set(vehicles.filter((v) => v.id !== vehicle?.id).map((v) => v.reg)), [vehicles, vehicle?.id])
  const schema = useMemo(() => makeSchema(taken), [taken])

  const driverOptions = useMemo(() => {
    const regOf = new Map(vehicles.map((v) => [v.id, v.reg]))
    return drivers
      .map((d) => {
        const lic = expiryState(d.licenceExpiry)
        const blocked = d.status === 'suspended' || lic.state === 'expired'
        const hint = d.status === 'suspended' ? 'Suspended' : lic.state === 'expired' ? 'Licence expired' : d.vehicleId ? `Drives ${regOf.get(d.vehicleId) ?? 'a vehicle'}` : 'Unassigned'
        return { value: d.id, label: d.name, hint, disabled: blocked, free: !d.vehicleId && !blocked }
      })
      .sort((a, b) => Number(b.free) - Number(a.free) || a.label.localeCompare(b.label))
  }, [drivers, vehicles])

  const defaults = useMemo<FormInput>(() => {
    if (vehicle) {
      return {
        reg: vehicle.reg, make: vehicle.make, model: vehicle.model, year: vehicle.year, category: vehicle.category, colour: vehicle.colour, vin: vehicle.vin, engineNo: vehicle.engineNo,
        fuelType: vehicle.fuelType, tankCapacityL: vehicle.tankCapacityL, loadCapacityKg: vehicle.loadCapacityKg, seats: vehicle.seats, axles: vehicle.axles, branchId: vehicle.branchId,
        odometerKm: vehicle.odometerKm, purchaseDate: toInputDate(vehicle.purchaseDate), purchaseCostUsd: vehicle.purchaseCostUsd, deviceId: vehicle.deviceId, driverId: '', notes: vehicle.notes ?? '',
      }
    }
    return {
      reg: '', make: '', model: '', year: CURRENT_YEAR, category: '', colour: 'White', vin: '', engineNo: '', fuelType: 'diesel', tankCapacityL: undefined, loadCapacityKg: undefined, seats: undefined, axles: 2,
      branchId: scopedBranch !== 'all' ? scopedBranch : '', odometerKm: 0, purchaseDate: format(new Date(), 'yyyy-MM-dd'), purchaseCostUsd: undefined,
      deviceId: `GPS-${Math.floor(100000 + Math.random() * 900000)}`, driverId: '', notes: '',
    } as unknown as FormInput
    // regenerate (device id) every time the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle, open, scopedBranch])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      size="lg"
      title={editing ? `Edit ${vehicle!.reg}` : 'Register vehicle'}
      description={editing ? 'Update the vehicle master record and specifications.' : 'Add a vehicle to the fleet. It appears on the live map once its GPS device reports.'}
      schema={schema}
      defaultValues={defaults}
      submitLabel={editing ? 'Save changes' : 'Register vehicle'}
      onSubmit={(values) => {
        if (editing) {
          updateVehicle(vehicle!.id, values as unknown as VehicleFormValues)
          toast.success(`${normaliseReg(values.reg)} updated`)
          return
        }
        const rec = createVehicle(values as unknown as VehicleFormValues)
        if (values.driverId) {
          try {
            assignDriver(rec.id, values.driverId)
          } catch (e) {
            toast.warning(e instanceof Error ? e.message : 'Driver could not be assigned')
          }
        }
        toast.success(`${rec.reg} registered`, { description: `${rec.make} ${rec.model} added to the fleet`, action: { label: 'View', onClick: () => navigate(`/vehicles/${rec.id}`) } })
        onCreated?.(rec)
      }}
    >
      {(form) => (
        <>
          <FormSection title="Identification">
            <FormGrid>
              <TextField form={form} name="reg" label="Registration" required placeholder="AAA 1234" hint="Zimbabwe format: three letters, four digits" />
              <TextField form={form} name="colour" label="Colour" required />
              <TextField form={form} name="make" label="Make" required placeholder="Scania" />
              <TextField form={form} name="model" label="Model" required placeholder="R 450 6x4" />
              <NumberField form={form} name="year" label="Model year" required min={1990} max={CURRENT_YEAR + 1} step={1} />
              <SelectField form={form} name="category" label="Category" required options={CATEGORY_OPTIONS} placeholder="Select category" />
              <TextField form={form} name="vin" label="VIN / chassis no." required placeholder="17 characters" hint="Exactly 17 letters / digits" />
              <TextField form={form} name="engineNo" label="Engine number" required />
            </FormGrid>
          </FormSection>

          <FormSection title="Specifications">
            <FormGrid>
              <SelectField form={form} name="fuelType" label="Fuel type" required options={FUEL_TYPE_OPTIONS} />
              <NumberField form={form} name="tankCapacityL" label="Tank capacity" required suffix="L" min={5} />
              <NumberField form={form} name="loadCapacityKg" label="Load capacity" required suffix="kg" min={10} />
              <NumberField form={form} name="axles" label="Axles" required min={2} max={8} step={1} />
              <NumberField form={form} name="seats" label="Seats" hint="Required for buses" min={1} max={90} step={1} />
            </FormGrid>
          </FormSection>

          <FormSection title="Assignment & telematics">
            <FormGrid>
              <SelectField form={form} name="branchId" label="Home branch / depot" required options={branchOptions} placeholder="Select branch" />
              <TextField form={form} name="deviceId" label="GPS device ID" required hint="Telematics unit installed in the vehicle" />
              <NumberField form={form} name="odometerKm" label="Odometer" required suffix="km" min={0} />
              {!editing && <ComboField form={form} name="driverId" label="Assigned driver" options={driverOptions} placeholder="Unassigned" searchPlaceholder="Search drivers…" clearable hint="Optional — suspended drivers and expired licences are disabled" />}
            </FormGrid>
          </FormSection>

          <FormSection title="Acquisition">
            <FormGrid>
              <TextField form={form} name="purchaseDate" type="date" label="Purchase date" required />
              <NumberField form={form} name="purchaseCostUsd" label="Purchase cost (USD)" required prefix="$" min={500} />
            </FormGrid>
          </FormSection>

          <TextAreaField form={form} name="notes" label="Notes" placeholder="Fitments, restrictions, body type…" rows={3} />
        </>
      )}
    </FormDialog>
  )
}

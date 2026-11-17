import { useEffect, useMemo } from 'react'
import { z } from 'zod'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, NumberField, SwitchField, TextField, fromInputDate, toInputDateTime, type AnyForm } from '@/components/forms/fields'
import { useDb } from '@/store/db'
import { getById } from '@/hooks/useLookup'
import { useDriverOptions, useVehicleOptions } from '@/hooks/useOptions'
import { fmtDate, fmtNumber } from '@/lib/format'
import { classifyFlag, detectFlag, TANK_TOLERANCE } from './lib'

const undef = undefined as unknown as number

function previousFill(vehicleId: string, iso: string) {
  const list = useDb.getState().fuelTransactions.filter((t) => t.vehicleId === vehicleId && t.date <= iso && (!t.flag || classifyFlag(t.flag.reason) !== 'odometer'))
  return list.sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null
}
function nextFill(vehicleId: string, iso: string) {
  const list = useDb.getState().fuelTransactions.filter((t) => t.vehicleId === vehicleId && t.date > iso && (!t.flag || classifyFlag(t.flag.reason) !== 'odometer'))
  return list.sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null
}

export const transactionSchema = z
  .object({
    vehicleId: z.string().min(1, 'Select a vehicle'),
    driverId: z.string().optional(),
    stationId: z.string().min(1, 'Select a station'),
    cardId: z.string().optional(),
    tripId: z.string().optional(),
    date: z.string().min(1, 'Date and time are required'),
    litres: z.number({ error: 'Enter the litres purchased' }).positive('Must be greater than 0'),
    pricePerLitreUsd: z.number({ error: 'Enter the price per litre' }).min(0.5, 'Price looks too low').max(5, 'Price looks too high'),
    odometerKm: z.number({ error: 'Enter the odometer reading' }).min(0, 'Cannot be negative'),
    fullTank: z.boolean(),
    receiptNo: z.string().trim().max(24, 'Max 24 characters').optional(),
  })
  .superRefine((v, ctx) => {
    const when = fromInputDate(v.date)
    if (when && new Date(when).getTime() > Date.now() + 5 * 6e4) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Date cannot be in the future' })
    const vehicle = getById('vehicles', v.vehicleId)
    if (vehicle && v.litres) {
      const max = Math.round(vehicle.tankCapacityL * TANK_TOLERANCE)
      if (v.litres > max) ctx.addIssue({ code: 'custom', path: ['litres'], message: `Exceeds tank capacity (${vehicle.tankCapacityL} L) by more than 10% — max ${max} L` })
    }
    if (vehicle && when && v.odometerKm !== undefined) {
      const prev = previousFill(vehicle.id, when)
      if (prev && v.odometerKm < prev.odometerKm) ctx.addIssue({ code: 'custom', path: ['odometerKm'], message: `Must be ≥ previous reading ${fmtNumber(prev.odometerKm)} km (${prev.ref}, ${fmtDate(prev.date)})` })
      const next = nextFill(vehicle.id, when)
      if (next && v.odometerKm > next.odometerKm) ctx.addIssue({ code: 'custom', path: ['odometerKm'], message: `Must be ≤ the later reading ${fmtNumber(next.odometerKm)} km (${next.ref})` })
    }
    const station = getById('fuelStations', v.stationId)
    if (station && station.status !== 'approved') ctx.addIssue({ code: 'custom', path: ['stationId'], message: 'This station is suspended and cannot be used' })
    const receipt = v.receiptNo?.trim()
    if (receipt) {
      const dup = useDb.getState().fuelTransactions.find((t) => t.receiptNo.toLowerCase() === receipt.toLowerCase())
      if (dup) ctx.addIssue({ code: 'custom', path: ['receiptNo'], message: `Receipt already recorded on ${dup.ref}` })
    }
  })

/** Fills driver, card and price from the chosen vehicle / station. */
function Autofill({ form }: { form: AnyForm }) {
  const vehicleId: string = form.watch('vehicleId')
  const stationId: string = form.watch('stationId')
  useEffect(() => {
    const v = getById('vehicles', vehicleId)
    if (!v) return
    form.setValue('driverId', v.driverId ?? '')
    const card = useDb.getState().fuelCards.find((c) => c.vehicleId === v.id && c.status === 'active')
    form.setValue('cardId', card?.id ?? '')
    form.setValue('tripId', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId])
  useEffect(() => {
    const v = getById('vehicles', vehicleId)
    const st = getById('fuelStations', stationId)
    if (!st) return
    form.setValue('pricePerLitreUsd', v?.fuelType === 'petrol' ? st.petrolPriceUsd : st.dieselPriceUsd, { shouldValidate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, vehicleId])
  return null
}

function VehicleHints({ form }: { form: AnyForm }) {
  const vehicleId: string = form.watch('vehicleId')
  const date: string = form.watch('date')
  const litres: number | undefined = form.watch('litres')
  const price: number | undefined = form.watch('pricePerLitreUsd')
  const vehicle = getById('vehicles', vehicleId)
  if (!vehicle) return null
  const prev = previousFill(vehicle.id, fromInputDate(date) || new Date().toISOString())
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
      <div className="space-y-0.5">
        <div>
          Tank <span className="num font-medium text-foreground">{vehicle.tankCapacityL} L</span> ({vehicle.fuelType}) · max {Math.round(vehicle.tankCapacityL * TANK_TOLERANCE)} L accepted
        </div>
        <div>{prev ? <>Previous fill <span className="font-medium text-foreground">{prev.ref}</span> on {fmtDate(prev.date)} at <span className="num font-medium text-foreground">{fmtNumber(prev.odometerKm)} km</span></> : 'No previous fill recorded for this vehicle'}</div>
        {litres && price ? <div>Total <span className="num font-medium text-foreground">${(Math.round(litres * price * 100) / 100).toFixed(2)}</span></div> : null}
      </div>
    </div>
  )
}

function TripField({ form }: { form: AnyForm }) {
  const vehicleId: string = form.watch('vehicleId')
  const trips = useDb((s) => s.trips)
  const options = useMemo(
    () => trips.filter((t) => t.vehicleId === vehicleId).sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)).slice(0, 25).map((t) => ({ value: t.id, label: t.ref, hint: `${t.origin.city} → ${t.destination.city}` })),
    [trips, vehicleId],
  )
  return <ComboField form={form} name="tripId" label="Linked trip" options={options} placeholder={vehicleId ? 'Optional' : 'Select a vehicle first'} clearable disabled={!vehicleId} />
}

export function TransactionFormDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const vehicleOptions = useVehicleOptions()
  const driverOptions = useDriverOptions()
  const stations = useDb((s) => s.fuelStations)
  const cards = useDb((s) => s.fuelCards)
  const stationOptions = useMemo(() => stations.map((s) => ({ value: s.id, label: s.name, hint: s.status === 'approved' ? s.city : `${s.city} · suspended`, disabled: s.status !== 'approved' })), [stations])
  const cardOptions = useMemo(() => cards.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: c.number, hint: c.provider })), [cards])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add fuel transaction"
      description="Record a fuel purchase. Detection rules run automatically and flag anything suspicious."
      schema={transactionSchema}
      size="lg"
      submitLabel="Add transaction"
      defaultValues={{ vehicleId: '', driverId: '', stationId: '', cardId: '', tripId: '', date: toInputDateTime(new Date().toISOString()), litres: undef, pricePerLitreUsd: undef, odometerKm: undef, fullTank: true, receiptNo: '' }}
      onSubmit={(v) => {
        const db = useDb.getState()
        const vehicle = getById('vehicles', v.vehicleId)!
        const iso = fromInputDate(v.date)
        const litres = Math.round(v.litres * 10) / 10
        let max = 30000
        for (const t of db.fuelTransactions) {
          const m = /^FT-(\d+)$/.exec(t.ref)
          if (m) max = Math.max(max, Number(m[1]))
        }
        const flag = detectFlag({ vehicle, litres, date: iso, odometerKm: Math.round(v.odometerKm), history: db.fuelTransactions.filter((t) => t.vehicleId === vehicle.id) })
        const rec = db.insert(
          'fuelTransactions',
          {
            ref: `FT-${max + 1}`,
            vehicleId: vehicle.id,
            driverId: v.driverId || null,
            stationId: v.stationId,
            cardId: v.cardId || null,
            branchId: vehicle.branchId,
            tripId: v.tripId || null,
            date: iso,
            litres,
            pricePerLitreUsd: v.pricePerLitreUsd,
            totalUsd: Math.round(litres * v.pricePerLitreUsd * 100) / 100,
            odometerKm: Math.round(v.odometerKm),
            fuelType: vehicle.fuelType,
            fullTank: v.fullTank,
            flag,
            reconciled: false,
            receiptNo: v.receiptNo?.trim() || `R${Math.floor(100000 + Math.random() * 900000)}`,
          },
          { summary: `Recorded fuel transaction FT-${max + 1} — ${litres} L for ${vehicle.reg}` },
        )
        if (flag) toast.warning(`${rec.ref} added and flagged`, { description: flag.reason })
        else toast.success(`Fuel transaction ${rec.ref} added`, { description: `${litres} L · ${vehicle.reg}` })
        onCreated?.(rec.id)
      }}
    >
      {(form) => (
        <>
          <Autofill form={form} />
          <FormGrid>
            <ComboField form={form} name="vehicleId" label="Vehicle" required options={vehicleOptions} placeholder="Select vehicle" searchPlaceholder="Search registration…" />
            <ComboField form={form} name="driverId" label="Driver" options={driverOptions} placeholder="Select driver" clearable />
          </FormGrid>
          <VehicleHints form={form} />
          <FormGrid>
            <ComboField form={form} name="stationId" label="Station" required options={stationOptions} placeholder="Select station" searchPlaceholder="Search stations…" />
            <ComboField form={form} name="cardId" label="Fuel card" options={cardOptions} placeholder="Cash / no card" clearable />
            <DateField form={form} name="date" label="Date & time" withTime required />
            <TripField form={form} />
            <NumberField form={form} name="litres" label="Litres" required suffix="L" min={0} step="0.1" />
            <NumberField form={form} name="pricePerLitreUsd" label="Price per litre" required prefix="$" min={0} step="0.01" hint="Prefilled from the station price list" />
            <NumberField form={form} name="odometerKm" label="Odometer" required suffix="km" min={0} step="1" />
            <TextField form={form} name="receiptNo" label="Receipt no." placeholder="Auto-generated if empty" />
          </FormGrid>
          <SwitchField form={form} name="fullTank" label="Full tank fill" hint="Used for consumption accuracy — partial fills make L/100 km less reliable." />
        </>
      )}
    </FormDialog>
  )
}

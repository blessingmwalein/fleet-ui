import { useMemo } from 'react'
import { useWatch } from 'react-hook-form'
import { z } from 'zod'
import type { ServiceSchedule } from '@/types'
import { useById } from '@/hooks/useLookup'
import { useVehicleOptions } from '@/hooks/useOptions'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, DateField, FormGrid, NumberField, TextField, type AnyForm } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtNumber } from '@/lib/format'
import { markServiced, saveSchedule } from '../lib/actions'
import { computeNextDue, localDateToIso, todayLocal, toLocalDate, useOdometers } from '../lib/maintenance'

const TASK_SUGGESTIONS = ['Routine service', 'Tyre inspection & rotation', 'Brake system inspection', 'Reefer unit service', 'Wheel alignment', 'Gearbox oil change', 'Battery & electrical check', 'Roadworthiness inspection']

function makeScheduleSchema(odometers: Map<string, number>) {
  return z
    .object({
      vehicleId: z.string().min(1, 'Select a vehicle'),
      task: z.string().trim().min(3, 'Enter the service task (min. 3 characters)').max(80, 'Max. 80 characters'),
      intervalKm: z.number({ error: 'Enter a number' }).int('Whole kilometres').positive('Must be greater than 0').max(200000, 'Unrealistically high').optional(),
      intervalDays: z.number({ error: 'Enter a number' }).int('Whole days').positive('Must be greater than 0').max(3650, 'Max. 10 years').optional(),
      lastServiceDate: z.string().min(1, 'Enter the last service date'),
      lastServiceKm: z.number({ error: 'Enter the odometer at last service' }).min(0, 'Must be positive'),
      estCostUsd: z.number({ error: 'Enter an estimated cost' }).min(0, 'Must be positive').max(100000, 'Unrealistically high'),
    })
    .superRefine((v, ctx) => {
      if (!v.intervalKm && !v.intervalDays) {
        ctx.addIssue({ code: 'custom', path: ['intervalKm'], message: 'Set a distance and/or a time interval' })
        ctx.addIssue({ code: 'custom', path: ['intervalDays'], message: 'Set a distance and/or a time interval' })
      }
      if (v.lastServiceDate && v.lastServiceDate > todayLocal()) ctx.addIssue({ code: 'custom', path: ['lastServiceDate'], message: 'The last service cannot be in the future' })
      const odo = odometers.get(v.vehicleId)
      if (odo !== undefined && v.lastServiceKm > odo + 1) ctx.addIssue({ code: 'custom', path: ['lastServiceKm'], message: `Higher than the current odometer (${fmtNumber(odo)} km)` })
    })
}

function NextDuePreview({ form }: { form: AnyForm }) {
  const [km, days, date, lastKm] = useWatch({ control: form.control, name: ['intervalKm', 'intervalDays', 'lastServiceDate', 'lastServiceKm'] }) as [number | undefined, number | undefined, string | undefined, number | undefined]
  if ((!km && !days) || !date || lastKm === undefined) return null
  const next = computeNextDue(km || null, days || null, new Date(`${date}T00:00:00`), lastKm)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/8 px-3 py-2 text-[13px]">
      <span className="text-muted-foreground">Next service will fall due</span>
      <span className="font-medium">
        <span className="num">{fmtDate(next.nextDueDate)}</span>
        {km ? <span className="num"> · at {fmtNumber(next.nextDueKm)} km</span> : null}
      </span>
    </div>
  )
}

function TaskChips({ form }: { form: AnyForm }) {
  return (
    <div className="-mt-1 flex flex-wrap gap-1">
      {TASK_SUGGESTIONS.map((t) => (
        <Button key={t} type="button" variant="outline" size="xs" onClick={() => form.setValue('task', t, { shouldValidate: true, shouldDirty: true })}>
          {t}
        </Button>
      ))}
    </div>
  )
}

export function ScheduleFormDialog({ open, onOpenChange, schedule, vehicleId }: { open: boolean; onOpenChange: (o: boolean) => void; schedule?: ServiceSchedule | null; vehicleId?: string }) {
  const options = useVehicleOptions()
  const odometers = useOdometers()
  const getVehicle = useById('vehicles')
  const schema = useMemo(() => makeScheduleSchema(odometers), [odometers])
  const editing = !!schedule
  const defaultValues = useMemo<z.input<ReturnType<typeof makeScheduleSchema>>>(() => {
    if (schedule) {
      return { vehicleId: schedule.vehicleId, task: schedule.task, intervalKm: schedule.intervalKm ?? undefined, intervalDays: schedule.intervalDays ?? undefined, lastServiceDate: toLocalDate(schedule.lastServiceDate), lastServiceKm: schedule.lastServiceKm, estCostUsd: schedule.estCostUsd }
    }
    const odo = vehicleId ? Math.round(odometers.get(vehicleId) ?? getVehicle(vehicleId)?.odometerKm ?? 0) : undefined
    return { vehicleId: vehicleId ?? '', task: '', intervalKm: undefined, intervalDays: undefined, lastServiceDate: todayLocal(), lastServiceKm: odo as number, estCostUsd: undefined as unknown as number }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, vehicleId, open])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit service schedule' : 'New service schedule'}
      description="Preventive tasks repeat by distance, time or both — whichever comes first makes the service due."
      schema={schema}
      defaultValues={defaultValues}
      submitLabel={editing ? 'Save changes' : 'Create schedule'}
      onSubmit={(v) =>
        saveSchedule(schedule ?? null, {
          vehicleId: v.vehicleId,
          task: v.task,
          intervalKm: v.intervalKm ?? null,
          intervalDays: v.intervalDays ?? null,
          lastServiceDate: localDateToIso(v.lastServiceDate),
          lastServiceKm: v.lastServiceKm,
          estCostUsd: v.estCostUsd,
        })
      }
    >
      {(form) => (
        <>
          <ComboField form={form} name="vehicleId" label="Vehicle" required options={options} placeholder="Select vehicle…" searchPlaceholder="Search registration or model…" disabled={editing} />
          <TextField form={form} name="task" label="Service task" required placeholder="e.g. Routine service" />
          <TaskChips form={form} />
          <FormGrid>
            <NumberField form={form} name="intervalKm" label="Interval — distance" suffix="km" min={0} step={500} placeholder="e.g. 15000" />
            <NumberField form={form} name="intervalDays" label="Interval — time" suffix="days" min={0} step={1} placeholder="e.g. 90" />
            <DateField form={form} name="lastServiceDate" label="Last serviced on" required max={todayLocal()} />
            <NumberField form={form} name="lastServiceKm" label="Odometer at last service" required suffix="km" min={0} />
          </FormGrid>
          <NumberField form={form} name="estCostUsd" label="Estimated cost per service" required suffix="USD" min={0} />
          <NextDuePreview form={form} />
        </>
      )}
    </FormDialog>
  )
}

export function MarkServicedDialog({ open, onOpenChange, schedule }: { open: boolean; onOpenChange: (o: boolean) => void; schedule?: ServiceSchedule }) {
  const odometers = useOdometers()
  const getVehicle = useById('vehicles')
  const veh = getVehicle(schedule?.vehicleId)
  const odo = schedule ? Math.round(odometers.get(schedule.vehicleId) ?? veh?.odometerKm ?? schedule.lastServiceKm) : 0
  const schema = useMemo(
    () =>
      z.object({
        date: z.string().min(1, 'Enter the service date').refine((d) => d <= todayLocal(), 'The service date cannot be in the future'),
        odometerKm: z.number({ error: 'Enter the odometer reading' }).min(schedule?.lastServiceKm ?? 0, `Cannot be lower than the last service (${fmtNumber(schedule?.lastServiceKm ?? 0)} km)`),
      }),
    [schedule?.lastServiceKm],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark as serviced"
      description={schedule && veh ? `${veh.reg} · ${schedule.task} — resets the interval counters and calculates the next due date.` : undefined}
      schema={schema}
      defaultValues={{ date: todayLocal(), odometerKm: odo }}
      submitLabel="Mark serviced"
      size="sm"
      onSubmit={(v) => schedule && markServiced(schedule, { date: localDateToIso(v.date), odometerKm: v.odometerKm })}
    >
      {(form) => (
        <>
          <DateField form={form} name="date" label="Serviced on" required max={todayLocal()} />
          <NumberField form={form} name="odometerKm" label="Odometer at service" required suffix="km" min={0} hint={`Current reading: ${fmtNumber(odo)} km`} />
        </>
      )}
    </FormDialog>
  )
}

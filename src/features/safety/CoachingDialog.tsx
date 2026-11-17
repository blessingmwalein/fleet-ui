import { z } from 'zod'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/display'
import { FormDialog } from '@/components/forms/FormDialog'
import { DateField, FormGrid, SelectField, TextAreaField } from '@/components/forms/fields'
import { useDb } from '@/store/db'
import { getById } from '@/hooks/useLookup'
import { fmtDate } from '@/lib/format'
import { SAFETY_EVENT_TYPE } from '@/config/status'
import { COACHING_TOPICS, topicFor, type DriverRisk } from './safety'

const METHODS = [
  { value: 'one_on_one', label: 'One-on-one session' },
  { value: 'ride_along', label: 'In-cab ride-along' },
  { value: 'classroom', label: 'Classroom / refresher course' },
  { value: 'toolbox', label: 'Toolbox talk' },
]

const schema = z
  .object({
    topic: z.string().min(1, 'Choose a coaching focus'),
    method: z.string().min(1, 'Choose how the session is delivered'),
    date: z.string().min(1, 'Enter the session date'),
    followUp: z.string().optional(),
    notes: z.string().trim().max(500, 'Keep notes under 500 characters').optional(),
  })
  .refine((d) => !d.followUp || d.followUp >= d.date, { path: ['followUp'], message: 'Follow-up must be on or after the session date' })

const today = () => new Date().toISOString().slice(0, 10)

/** Log a coaching session for one or more drivers: writes a note on the driver record and an audit entry per driver. */
export function CoachingDialog({ open, onOpenChange, targets }: { open: boolean; onOpenChange: (o: boolean) => void; targets: DriverRisk[] }) {
  const single = targets.length === 1 ? targets[0]! : null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={single ? `Coach ${single.name}` : `Coach ${targets.length} drivers`}
      description={single ? `Score ${single.score}/100 · ${single.events} events in the selected period${single?.topType ? ` · main issue ${SAFETY_EVENT_TYPE[single.topType].toLowerCase()} (${single.topCount})` : ''}` : 'Record the same coaching session against each selected driver.'}
      schema={schema}
      defaultValues={{ topic: topicFor(single?.topType ?? null), method: 'one_on_one', date: today(), followUp: '', notes: '' }}
      submitLabel="Log coaching"
      onSubmit={(v) => {
        const topic = COACHING_TOPICS.find((t) => t.value === v.topic)?.label ?? v.topic
        const method = METHODS.find((m) => m.value === v.method)?.label ?? v.method
        const date = new Date(`${v.date}T09:00:00`).toISOString()
        for (const t of targets) {
          const current = getById('drivers', t.id)
          const line = `[${fmtDate(date)}] Coaching — ${topic} (${method})${v.notes ? `: ${v.notes}` : ''}${v.followUp ? ` · follow-up ${fmtDate(`${v.followUp}T09:00:00`)}` : ''}`
          useDb.getState().update('drivers', t.id, { notes: current?.notes ? `${current.notes}\n${line}` : line }, { action: 'update', summary: `Coaching session logged for ${t.name} — ${topic}` })
        }
        toast.success(single ? `Coaching logged for ${single.name}` : `Coaching logged for ${targets.length} drivers`, { description: `${topic} · ${method}` })
      }}
    >
      {(form) => (
        <>
          <div className="flex flex-wrap gap-1.5">
            {targets.slice(0, 8).map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs">
                <Avatar name={t.name} size={18} />
                {t.name}
                <span className="num text-muted-foreground">{t.score}</span>
              </span>
            ))}
            {targets.length > 8 && <span className="px-1 text-xs text-muted-foreground">+{targets.length - 8} more</span>}
          </div>
          <SelectField form={form} name="topic" label="Coaching focus" required options={COACHING_TOPICS.map((t) => ({ value: t.value, label: t.label }))} />
          <FormGrid>
            <SelectField form={form} name="method" label="Delivery" required options={METHODS} />
            <DateField form={form} name="date" label="Session date" required />
          </FormGrid>
          <DateField form={form} name="followUp" label="Follow-up review (optional)" hint="Schedule a re-check of the driver's score." />
          <TextAreaField form={form} name="notes" label="Notes" placeholder="Agreed actions, driver commitments, observations…" rows={3} />
        </>
      )}
    </FormDialog>
  )
}

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { EyeOff, Siren, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormDialog } from '@/components/forms/FormDialog'
import { SelectField, TextAreaField } from '@/components/forms/fields'
import { fmtDateTime } from '@/lib/format'
import { Plate } from '@/components/shared/Status'
import { RULE_ICON, FlagBadge } from './components'
import { dismissFlag, escalateFlag, startReview, type FlagAction } from './actions'
import { explainFlag, type FuelRow } from './lib'
import { useFuelPerms } from './hooks'

const reviewSchema = z.object({ note: z.string().trim().max(400).optional() })
const dismissSchema = z.object({ note: z.string().trim().min(5, 'Explain why this is a false positive (min. 5 characters)').max(400) })
const escalateSchema = z.object({
  severity: z.enum(['minor', 'moderate', 'major', 'critical']),
  note: z.string().trim().min(5, 'Add context for the investigator (min. 5 characters)').max(400),
})

function Summary({ row }: { row: FuelRow }) {
  const ex = explainFlag(row)
  const Icon = RULE_ICON[ex?.rule ?? 'other']
  return (
    <div className="rounded-md border border-border bg-surface-2/50 p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <Icon className="size-4 text-warning" />
          {ex?.title ?? 'Flagged transaction'}
        </div>
        <FlagBadge flag={row.flag} state={row.flagState} rule={row.rule} compact />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{ex?.detail}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
        <span className="num font-medium text-foreground">{row.ref}</span>
        <Plate>{row.reg}</Plate>
        <span>{row.stationName}</span>
        <span>{fmtDateTime(row.date)}</span>
      </div>
    </div>
  )
}

/**
 * Review / Dismiss / Escalate workflow for flagged fuel transactions.
 *   const flags = useFlagActions()
 *   <Button onClick={() => flags.start('dismiss', row)} />  …  {flags.dialogs}
 */
export function useFlagActions() {
  const { canReview } = useFuelPerms()
  const [state, setState] = useState<{ mode: FlagAction; row: FuelRow } | null>(null)
  const start = useCallback((mode: FlagAction, row: FuelRow) => setState({ mode, row }), [])
  const close = useCallback(() => setState(null), [])
  const row = state?.row
  const mode = state?.mode

  const dialogs: ReactNode = useMemo(
    () => (
      <>
        <FormDialog
          open={mode === 'review' && !!row}
          onOpenChange={(o) => !o && close()}
          title="Start review"
          description="Assign this flagged fill to yourself and mark it as under review. It stays flagged until dismissed or escalated."
          schema={reviewSchema}
          defaultValues={{ note: '' }}
          submitLabel="Start review"
          onSubmit={(v) => {
            if (row) startReview(row, v.note)
          }}
        >
          {(form) => (
            <>
              {row && <Summary row={row} />}
              <TextAreaField form={form} name="note" label="Review note (optional)" placeholder="e.g. Requested the pump receipt from the driver" />
            </>
          )}
        </FormDialog>

        <FormDialog
          open={mode === 'dismiss' && !!row}
          onOpenChange={(o) => !o && close()}
          title="Dismiss flag"
          description="Mark this flag as a false positive. The flag is cleared from the transaction; your reason is kept in the audit log."
          schema={dismissSchema}
          defaultValues={{ note: '' }}
          submitLabel="Dismiss flag"
          onSubmit={(v) => {
            if (row) dismissFlag(row, v.note)
          }}
        >
          {(form) => (
            <>
              {row && <Summary row={row} />}
              <TextAreaField form={form} name="note" label="Reason" required placeholder="e.g. Driver confirmed an extra jerrycan was filled for the generator at the depot" />
            </>
          )}
        </FormDialog>

        <FormDialog
          open={mode === 'escalate' && !!row}
          onOpenChange={(o) => !o && close()}
          title="Escalate to Safety"
          description="Raises an incident for investigation (suspected fuel theft / misuse) linked to this vehicle, driver and trip."
          schema={escalateSchema}
          defaultValues={{ severity: row?.flag?.severity === 'high' ? 'major' : row?.flag?.severity === 'medium' ? 'moderate' : 'minor', note: '' }}
          submitLabel="Escalate"
          destructive
          onSubmit={(v) => {
            if (row) escalateFlag(row, v.note, v.severity)
          }}
        >
          {(form) => (
            <>
              {row && <Summary row={row} />}
              <SelectField
                form={form}
                name="severity"
                label="Incident severity"
                required
                options={[
                  { value: 'minor', label: 'Minor' },
                  { value: 'moderate', label: 'Moderate' },
                  { value: 'major', label: 'Major' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
              <TextAreaField form={form} name="note" label="Context for the investigator" required placeholder="What should the investigator look at first?" />
            </>
          )}
        </FormDialog>
      </>
    ),
    [mode, row, close],
  )

  return { start, dialogs, canReview }
}

/** The three action buttons for a flagged row (hidden without permission or once escalated). */
export function FlagActionButtons({ row, flags, size = 'xs', showReview = true }: { row: FuelRow; flags: ReturnType<typeof useFlagActions>; size?: 'xs' | 'sm'; showReview?: boolean }) {
  if (!row.flag || !flags.canReview || row.flagState === 'escalated') return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showReview && row.flagState !== 'reviewing' && (
        <Button size={size} variant="outline" onClick={() => flags.start('review', row)}>
          <ScanSearch /> Review
        </Button>
      )}
      <Button size={size} variant="outline" onClick={() => flags.start('dismiss', row)}>
        <EyeOff /> Dismiss
      </Button>
      <Button size={size} variant="outline" className="border-danger/40 text-danger hover:bg-danger/10" onClick={() => flags.start('escalate', row)}>
        <Siren /> Escalate
      </Button>
    </div>
  )
}

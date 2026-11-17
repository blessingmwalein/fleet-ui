import { useMemo } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import type { Expense } from '@/types'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { can } from '@/hooks/useAuth'
import { fmtUsd } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { FormDialog } from '@/components/forms/FormDialog'
import { TextAreaField } from '@/components/forms/fields'
import { useActorName } from './hooks'

const REJECT_PRESETS = ['No receipt attached', 'Amount exceeds policy limit', 'Duplicate claim', 'Not a business expense']
const total = (rows: Expense[]) => rows.reduce((s, e) => s + e.amountUsd, 0)
const noun = (n: number) => `${n} expense${n === 1 ? '' : 's'}`

/** Approval workflow operations (single & bulk). All permission-checked, confirmed where destructive, audit-logged and toasted. */
export function useExpenseActions() {
  const actor = useActorName()
  return useMemo(() => {
    const guard = (perm: 'finance.approve' | 'finance.delete' | 'finance.edit') => {
      if (can(perm)) return true
      toast.error('Your role does not have permission for this action')
      return false
    }

    async function approve(rows: Expense[]) {
      if (!guard('finance.approve')) return 0
      const eligible = rows.filter((e) => e.status === 'pending')
      if (!eligible.length) {
        toast.info('Nothing to approve — only pending expenses can be approved')
        return 0
      }
      if (eligible.length > 1 || eligible[0]!.amountUsd >= 1000) {
        const ok = await confirm({
          title: `Approve ${noun(eligible.length)}?`,
          description: `${fmtUsd(total(eligible), { digits: 2 })} will be approved for payment${rows.length > eligible.length ? ` (${rows.length - eligible.length} selected item(s) are not pending and will be skipped)` : ''}.`,
          confirmLabel: 'Approve',
        })
        if (!ok) return 0
      }
      const ids = eligible.map((e) => e.id)
      const db = useDb.getState()
      if (ids.length === 1) db.update('expenses', ids[0]!, { status: 'approved', approvedBy: actor, rejectionReason: undefined }, { action: 'approve', summary: `Approved expense ${eligible[0]!.ref} (${fmtUsd(eligible[0]!.amountUsd, { digits: 2 })})` })
      else db.updateMany('expenses', ids, { status: 'approved', approvedBy: actor, rejectionReason: undefined }, { action: 'approve', summary: `Approved ${ids.length} expenses (${fmtUsd(total(eligible), { digits: 2 })})` })
      toast.success(`Approved ${noun(ids.length)}`, {
        description: fmtUsd(total(eligible), { digits: 2 }),
        action: { label: 'Undo', onClick: () => useDb.getState().updateMany('expenses', ids, { status: 'pending', approvedBy: undefined }, { action: 'status', summary: `Reverted approval of ${ids.length} expense(s)` }) },
      })
      return ids.length
    }

    function reject(rows: Expense[], reason: string) {
      if (!guard('finance.approve')) return 0
      const eligible = rows.filter((e) => e.status === 'pending')
      if (!eligible.length) {
        toast.info('Nothing to reject — only pending expenses can be rejected')
        return 0
      }
      const ids = eligible.map((e) => e.id)
      useDb.getState().updateMany('expenses', ids, { status: 'rejected', rejectionReason: reason, approvedBy: undefined }, { action: 'status', summary: ids.length === 1 ? `Rejected expense ${eligible[0]!.ref}: ${reason}` : `Rejected ${ids.length} expenses: ${reason}` })
      toast.success(`Rejected ${noun(ids.length)}`, { action: { label: 'Undo', onClick: () => useDb.getState().updateMany('expenses', ids, { status: 'pending', rejectionReason: undefined }, { action: 'status', summary: `Reverted rejection of ${ids.length} expense(s)` }) } })
      return ids.length
    }

    async function pay(rows: Expense[]) {
      if (!guard('finance.approve')) return 0
      const eligible = rows.filter((e) => e.status === 'approved')
      if (!eligible.length) {
        toast.info('Nothing to pay — only approved expenses can be marked as paid')
        return 0
      }
      const ok = await confirm({ title: `Mark ${noun(eligible.length)} as paid?`, description: `${fmtUsd(total(eligible), { digits: 2 })} will be recorded as disbursed.`, confirmLabel: 'Mark as paid' })
      if (!ok) return 0
      useDb.getState().updateMany('expenses', eligible.map((e) => e.id), { status: 'paid' }, { action: 'status', summary: eligible.length === 1 ? `Marked expense ${eligible[0]!.ref} as paid` : `Marked ${eligible.length} expenses as paid (${fmtUsd(total(eligible), { digits: 2 })})` })
      toast.success(`${noun(eligible.length)} marked as paid`)
      return eligible.length
    }

    async function remove(rows: Expense[]) {
      if (!guard('finance.delete')) return 0
      const eligible = rows.filter((e) => e.status === 'pending' || e.status === 'rejected')
      if (!eligible.length) {
        toast.info('Only pending or rejected expenses can be deleted')
        return 0
      }
      const ok = await confirm({ title: `Delete ${noun(eligible.length)}?`, description: 'This permanently removes the claim. Approved and paid expenses cannot be deleted.', confirmLabel: 'Delete', destructive: true })
      if (!ok) return 0
      const db = useDb.getState()
      if (eligible.length === 1) db.remove('expenses', eligible[0]!.id)
      else db.removeMany('expenses', eligible.map((e) => e.id))
      toast.success(`Deleted ${noun(eligible.length)}`)
      return eligible.length
    }

    return { approve, reject, pay, remove }
  }, [actor])
}

const rejectSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters (the submitter will see it)').max(200) })

/** Reject dialog (single or bulk) with quick-reason chips. */
export function RejectExpenseDialog({ rows, onClose }: { rows: Expense[] | null; onClose: () => void }) {
  const actions = useExpenseActions()
  const list = rows ?? []
  return (
    <FormDialog
      open={!!rows}
      onOpenChange={(o) => !o && onClose()}
      title={list.length === 1 ? `Reject ${list[0]!.ref}` : `Reject ${list.length} expenses`}
      description={`${fmtUsd(total(list), { digits: 2 })} — the submitter is notified with your reason.`}
      schema={rejectSchema}
      defaultValues={{ reason: '' }}
      submitLabel="Reject"
      destructive
      onSubmit={(v) => {
        actions.reject(list, v.reason)
      }}
    >
      {(form) => (
        <>
          <div className="flex flex-wrap gap-1.5">
            {REJECT_PRESETS.map((p) => (
              <Button key={p} type="button" size="xs" variant="outline" onClick={() => form.setValue('reason', p, { shouldValidate: true })}>
                {p}
              </Button>
            ))}
          </div>
          <TextAreaField form={form} name="reason" label="Reason for rejection" required rows={3} placeholder="Explain why this claim cannot be approved" />
        </>
      )}
    </FormDialog>
  )
}

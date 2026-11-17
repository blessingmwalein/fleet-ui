import * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'
import type { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { useZodForm } from './fields'

interface FormDialogProps<S extends z.ZodType<any, any>> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  schema: S
  /** Values used to (re)initialise the form each time it opens. */
  defaultValues: z.input<S>
  /** Return/await to show the submitting state. Throw to keep the dialog open and surface the message. */
  onSubmit: (values: z.output<S>) => void | Promise<void>
  submitLabel?: string
  /** Render form fields. Use the field components from `components/forms/fields`. */
  children: (form: UseFormReturn<z.input<S>, unknown, z.output<S>>) => React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** 'dialog' (default) or a right-hand 'sheet' for long forms. */
  variant?: 'dialog' | 'sheet'
  destructive?: boolean
  /** Extra footer content shown on the left (e.g. a secondary action). */
  footerExtra?: React.ReactNode
}

/**
 * Validated modal form. Handles reset-on-open, async submit state, field errors and closing on success.
 *
 *   <FormDialog open={open} onOpenChange={setOpen} title="Add vehicle" schema={schema} defaultValues={...}
 *     onSubmit={(v) => { db.insert('vehicles', ...); toast.success('Vehicle added') }}>
 *     {(form) => <TextField form={form} name="reg" label="Registration" required />}
 *   </FormDialog>
 */
export function FormDialog<S extends z.ZodType<any, any>>({ open, onOpenChange, title, description, schema, defaultValues, onSubmit, submitLabel = 'Save', children, size = 'md', variant = 'dialog', destructive, footerExtra }: FormDialogProps<S>) {
  const form = useZodForm(schema, defaultValues)
  const [formError, setFormError] = React.useState<string | null>(null)
  const submitting = form.formState.isSubmitting

  React.useEffect(() => {
    if (open) {
      form.reset(defaultValues as never)
      setFormError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onOpenChange(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong')
    }
  })

  const inner = (
    <form onSubmit={(e) => { e.stopPropagation(); void submit(e) }} noValidate className="flex min-h-0 flex-1 flex-col">
      {variant === 'sheet' ? <SheetBody className="space-y-5">{children(form)}</SheetBody> : <DialogBody className="space-y-4">{children(form)}</DialogBody>}
      {formError && <p role="alert" className="border-t border-danger/30 bg-danger/10 px-5 py-2 text-xs text-danger">{formError}</p>}
      {Object.keys(form.formState.errors).length > 0 && form.formState.isSubmitted && !formError && (
        <p role="alert" className="border-t border-danger/30 bg-danger/10 px-5 py-2 text-xs text-danger">Please fix the highlighted fields.</p>
      )}
      {variant === 'sheet' ? (
        <SheetFooter>{footer()}</SheetFooter>
      ) : (
        <DialogFooter>{footer()}</DialogFooter>
      )}
    </form>
  )

  function footer() {
    return (
      <>
        {footerExtra && <div className="mr-auto">{footerExtra}</div>}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </>
    )
  }

  if (variant === 'sheet') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent size={size === 'sm' ? 'sm' : size === 'md' ? 'md' : size === 'lg' ? 'lg' : 'xl'}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          {inner}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {inner}
      </DialogContent>
    </Dialog>
  )
}

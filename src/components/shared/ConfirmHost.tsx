import { useConfirmStore } from '@/store/confirm'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/overlays'
import { Button } from '@/components/ui/button'

/** Mounted once in the app shell — renders dialogs requested through `confirm()`. */
export function ConfirmHost() {
  const { open, options, settle } = useConfirmStore()
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && settle(false)}>
      <AlertDialogContent>
        <AlertDialogTitle>{options?.title}</AlertDialogTitle>
        {options?.description && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
        <div className="mt-5 flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline" onClick={() => settle(false)}>{options?.cancelLabel ?? 'Cancel'}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant={options?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>{options?.confirmLabel ?? (options?.destructive ? 'Delete' : 'Confirm')}</Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

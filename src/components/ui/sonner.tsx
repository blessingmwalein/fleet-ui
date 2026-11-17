import { Toaster as Sonner } from 'sonner'
import { useUi } from '@/store/ui'

export function Toaster() {
  const theme = useUi((s) => s.theme)
  return (
    <Sonner
      theme={theme === 'system' ? 'system' : theme}
      position="bottom-right"
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast: '!bg-popover !text-popover-foreground !border !border-border !shadow-pop !rounded-lg !text-[13px] !font-sans',
          description: '!text-muted-foreground !text-xs',
          actionButton: '!bg-primary !text-primary-foreground !text-xs !font-medium',
          cancelButton: '!bg-secondary !text-secondary-foreground',
          closeButton: '!bg-popover !border-border !text-muted-foreground',
        },
      }}
    />
  )
}

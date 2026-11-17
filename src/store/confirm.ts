import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface ConfirmStore {
  open: boolean
  options: ConfirmOptions | null
  resolver: ((v: boolean) => void) | null
  ask: (o: ConfirmOptions) => Promise<boolean>
  settle: (v: boolean) => void
}

export const useConfirmStore = create<ConfirmStore>()((set, get) => ({
  open: false,
  options: null,
  resolver: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      get().resolver?.(false)
      set({ open: true, options, resolver: resolve })
    }),
  settle: (v) => {
    get().resolver?.(v)
    set({ open: false, resolver: null })
  },
}))

/**
 * Promise-based confirmation dialog:
 *   if (await confirm({ title: 'Delete vehicle?', destructive: true })) { ... }
 */
export function confirm(options: ConfirmOptions) {
  return useConfirmStore.getState().ask(options)
}

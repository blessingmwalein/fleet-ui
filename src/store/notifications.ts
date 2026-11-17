import { create } from 'zustand'
import { toast } from 'sonner'
import type { AppNotification } from '@/types'
import { NOTIF_STORAGE_KEY, getSeed } from '@/data/bootstrap'
import { eventBus, type LiveEvent } from '@/services/events'
import { openEntity } from '@/lib/navigation'
import { useSettings } from './settings'

const MAX_ITEMS = 150

function load(): AppNotification[] {
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as AppNotification[]
  } catch {
    /* fall through to seed */
  }
  return getSeed().notifications
}

interface NotificationStore {
  items: AppNotification[]
  push: (n: Omit<AppNotification, 'id' | 'read' | 'ts'> & { ts?: number }) => AppNotification
  markRead: (id: string) => void
  markUnread: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clear: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useNotifications = create<NotificationStore>()((set, get) => ({
  items: load(),
  push: (n) => {
    const item: AppNotification = { ...n, id: `ntf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: new Date(n.ts ?? Date.now()).toISOString(), read: false }
    set({ items: [item, ...get().items].slice(0, MAX_ITEMS) })
    return item
  },
  markRead: (id) => set({ items: get().items.map((x) => (x.id === id ? { ...x, read: true } : x)) }),
  markUnread: (id) => set({ items: get().items.map((x) => (x.id === id ? { ...x, read: false } : x)) }),
  markAllRead: () => set({ items: get().items.map((x) => ({ ...x, read: true })) }),
  remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
  clear: () => set({ items: [] }),
}))

useNotifications.subscribe((s) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(s.items))
    } catch {
      /* quota — ignore */
    }
  }, 500)
})

/** Bridges the event bus into the notification centre, honouring per-type channel preferences. */
export function ingestEvent(e: LiveEvent) {
  const prefs = useSettings.getState().notificationPrefs[e.type]
  if (prefs && !prefs.inApp) return
  const item = useNotifications.getState().push({ type: e.type, severity: e.severity, title: e.title, message: e.message, entity: e.entity, ts: e.ts })
  if (e.severity === 'info' && e.type !== 'system') return // keep routine info events out of the toast stack
  const fn = e.severity === 'critical' ? toast.error : e.severity === 'warning' ? toast.warning : e.severity === 'success' ? toast.success : toast.info
  fn(e.title, {
    description: e.message,
    duration: e.severity === 'critical' ? 8000 : 5000,
    action: e.entity ? { label: 'View', onClick: () => { useNotifications.getState().markRead(item.id); openEntity(e.entity!) } } : undefined,
  })
}

let wired = false
export function wireNotificationBridge() {
  if (wired) return
  wired = true
  eventBus.subscribe(ingestEvent)
}

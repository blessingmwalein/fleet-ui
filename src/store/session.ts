import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CURRENT_USER_ID } from '@/data/seed/org'

/** Demo session: which seeded user is "signed in". Switching users demonstrates role-based navigation. */
interface SessionState {
  userId: string
  switchUser: (id: string) => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      userId: CURRENT_USER_ID,
      switchUser: (id) => set({ userId: id }),
    }),
    { name: 'fleetcore.session' },
  ),
)

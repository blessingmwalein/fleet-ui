import { useEffect, useState } from 'react'
import { useUi } from '@/store/ui'

/** Resolved dark/light mode (handles the "system" theme). */
export function useIsDark() {
  const theme = useUi((s) => s.theme)
  const [system, setSystem] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystem(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return theme === 'dark' || (theme === 'system' && system)
}

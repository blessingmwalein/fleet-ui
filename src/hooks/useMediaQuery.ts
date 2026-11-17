import { useEffect, useState } from 'react'

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatches(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return matches
}

/** < 768px */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)')
/** < 1024px */
export const useIsCompact = () => useMediaQuery('(max-width: 1023px)')

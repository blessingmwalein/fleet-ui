import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb, type CollectionName, type ItemOf } from '@/store/db'

const cache = new WeakMap<object, Map<string, unknown>>()

function indexOf<K extends CollectionName>(list: ItemOf<K>[]): Map<string, ItemOf<K>> {
  let m = cache.get(list)
  if (!m) {
    m = new Map((list as { id: string }[]).map((x) => [x.id, x]))
    cache.set(list, m)
  }
  return m as Map<string, ItemOf<K>>
}

/**
 * `const vehicle = useById('vehicles')(id)` — O(1) lookup that re-renders only when the collection changes.
 * Pass null/undefined ids safely.
 */
export function useById<K extends CollectionName>(collection: K) {
  const list = useDb((s) => s[collection]) as ItemOf<K>[]
  const map = useMemo(() => indexOf<K>(list), [list])
  return useCallback((id: string | null | undefined) => (id ? map.get(id) : undefined), [map])
}

/** Non-reactive lookup for services. */
export function getById<K extends CollectionName>(collection: K, id: string | null | undefined): ItemOf<K> | undefined {
  if (!id) return undefined
  return indexOf<K>(useDb.getState()[collection] as ItemOf<K>[]).get(id)
}

/**
 * Deep-link helper for list pages: `?open=<id>` opens the detail drawer for that record.
 *   const [openId, setOpenId] = useOpenParam()
 */
export function useOpenParam(key = 'open') {
  const [params, setParams] = useSearchParams()
  const value = params.get(key)
  const set = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) next.set(key, id)
          else next.delete(key)
          return next
        },
        { replace: true },
      )
    },
    [setParams, key],
  )
  return [value, set] as const
}

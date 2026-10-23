// Ported from T3 Code: usePermissionStatus.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PermissionStatus } from '../../../shared/api'
import { pollPermissions } from '../../../shared/permission-poll'
import { reel } from '../api'

/** `apply` takes an action's answer and drops a check already on its way, so the row never flips back for a moment. */
export function usePermissionStatus() {
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    return pollPermissions(
      async () => {
        const g = generation.current
        return { g, s: await reel.perm.status() }
      },
      {
        status: (r) => {
          if (r.g === generation.current) setStatus(r.s)
        },
        error: setError
      },
      {
        hidden: () => document.visibilityState === 'hidden',
        every: (fn, ms) => {
          const t = window.setInterval(fn, ms)
          return () => window.clearInterval(t)
        },
        onWake: (fn) => {
          window.addEventListener('focus', fn)
          document.addEventListener('visibilitychange', fn)
          return () => {
            window.removeEventListener('focus', fn)
            document.removeEventListener('visibilitychange', fn)
          }
        }
      }
    )
  }, [])
  const apply = useCallback((s: PermissionStatus) => {
    generation.current++
    setStatus(s)
  }, [])
  return { status, error, apply }
}

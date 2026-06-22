import { useState, useEffect, useCallback } from 'react'
import { LAYOUT_MODE_KEY, type LayoutMode, isValidLayoutMode } from './layoutMode'

export function useLayoutMode(): { mode: LayoutMode; setMode: (m: LayoutMode) => void; isDesktopCapable: boolean } {
  const [isDesktopCapable, setIsDesktopCapable] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktopCapable(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolveMode = useCallback(
    (capable: boolean): LayoutMode => {
      if (!capable) return 'mobile'
      try {
        const stored = localStorage.getItem(LAYOUT_MODE_KEY)
        if (isValidLayoutMode(stored)) return stored
      } catch {
        // localStorage unavailable
      }
      return 'desktop'
    },
    [],
  )

  const [mode, setModeState] = useState<LayoutMode>(() =>
    resolveMode(window.matchMedia('(min-width: 768px)').matches),
  )

  useEffect(() => {
    setModeState(resolveMode(isDesktopCapable))
  }, [isDesktopCapable, resolveMode])

  const setMode = useCallback((m: LayoutMode) => {
    try {
      localStorage.setItem(LAYOUT_MODE_KEY, m)
    } catch {
      // localStorage unavailable
    }
    setModeState(m)
  }, [])

  return { mode, setMode, isDesktopCapable }
}

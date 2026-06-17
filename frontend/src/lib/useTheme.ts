import { useCallback, useLayoutEffect, useState } from 'react'
import { DEFAULT_THEME, THEME_STORAGE_KEY, isValidThemeId, type ThemeId } from './theme'

/**
 * Reads the persisted theme, validating against the strict allowlist so a
 * corrupt/foreign storage value falls back to the default rather than leaking
 * through. All storage access is guarded (private-mode / quota safety).
 */
function readStoredTheme(): ThemeId {
  try {
    const stored = window.sessionStorage.getItem(THEME_STORAGE_KEY)
    return isValidThemeId(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * Personal, client-side theme state (VP-7.2, D-6).
 *
 * Binds the selection to `data-theme` on `<html>` so every page (lobby, room,
 * info, admin shell) and the `<body>` field gradient pick it up globally, and
 * persists it to `sessionStorage` only — no localStorage, cookie, socket, or
 * WebRTC payload. Resets to the default when the tab closes.
 *
 * Intended to be used once at the app root; `theme`/`setTheme` are passed down
 * to the switcher so there is a single source of truth.
 */
export function useTheme(): { theme: ThemeId; setTheme: (next: ThemeId) => void } {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme)

  // Layout effect so the attribute is set before paint (covers in-tab reload).
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = useCallback((next: ThemeId) => {
    if (!isValidThemeId(next)) return
    setThemeState(next)
    try {
      window.sessionStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // private-mode / quota — selection still applies for this session.
    }
  }, [])

  return { theme, setTheme }
}

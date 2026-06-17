/**
 * Theme registry (VP-7.2, D-6).
 *
 * Themes are a personal, client-side UI preference — Light, Dark, and Blue
 * (default). There is no backend, socket, or WebRTC involvement; the selected id is
 * persisted in `sessionStorage` only (see {@link THEME_STORAGE_KEY}) and bound to
 * the `data-theme` attribute on `<html>`, which drives the `--vapor-*` CSS
 * variable swaps in `index.css`.
 *
 * Pure module: no React, no DOM I/O. App-wide (lives in `lib/`, not
 * `features/room/`) because theme is global, not room-scoped.
 */

export const THEME_IDS = ['light', 'dark', 'blue'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME: ThemeId = 'blue'

/** sessionStorage key. Dot-namespaced to match `vapor.reconnect.session`. */
export const THEME_STORAGE_KEY = 'vapor.theme'

export interface ThemeMeta {
  /** Human-readable name shown in the switcher control. */
  label: string
  /** Short description used as the control's tooltip / `title`. */
  description: string
  /**
   * Fixed representative colour for the picker swatch. This is intentionally a
   * literal (not a `--vapor-*` token): the switcher previews all three themes at
   * once, so each swatch must render its own colour regardless of the active
   * theme. The single source of truth for these preview colours is this module.
   */
  swatch: string
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  light: {
    label: 'Light',
    description: 'Soft, light mist palette.',
    swatch: 'oklch(0.93 0.014 190)',
  },
  dark: {
    label: 'Dark',
    description: 'Deep slate palette for low-light use.',
    swatch: 'oklch(0.22 0.02 240)',
  },
  blue: {
    label: 'Blue',
    description: 'Deep #006699-based palette (default).',
    swatch: 'oklch(0.5 0.11 233)',
  },
}

/**
 * Strict allowlist guard. Used when reading the persisted value back — storage
 * is never trusted. Rejects everything outside the exact `THEME_IDS` set,
 * including objects, numbers, casing variants, and trailing-space strings.
 */
export function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

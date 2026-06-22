export const LAYOUT_MODE_KEY = 'vapor.layoutMode'
export const LAYOUT_MODES = ['mobile', 'desktop'] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

export function isValidLayoutMode(v: unknown): v is LayoutMode {
  return LAYOUT_MODES.includes(v as LayoutMode)
}

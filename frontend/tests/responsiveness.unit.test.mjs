import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const indexCss      = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8')
const lobbyView     = readFileSync(resolve(ROOT, 'src/features/room/LobbyView.tsx'), 'utf8')
const roomView      = readFileSync(resolve(ROOT, 'src/features/room/RoomView.tsx'), 'utf8')

// ---- T8.1-02: dvh-based height replaces aspect-ratio in .vapor-app-frame ----

test('T8.1-02a: .vapor-app-frame uses dvh-based height', () => {
  assert.ok(
    indexCss.includes('height: calc(100dvh - 6rem)'),
    '.vapor-app-frame must use height: calc(100dvh - 6rem)',
  )
})

test('T8.1-02b: .vapor-app-frame has matching max-height cap', () => {
  assert.ok(
    indexCss.includes('max-height: calc(100dvh - 6rem)'),
    '.vapor-app-frame must set max-height: calc(100dvh - 6rem) to prevent overflow',
  )
})

test('T8.1-02c: .vapor-app-frame does not use aspect-ratio', () => {
  const frameBlock = indexCss.slice(
    indexCss.indexOf('.vapor-app-frame'),
    indexCss.indexOf('}', indexCss.indexOf('.vapor-app-frame')) + 1,
  )
  assert.ok(
    !frameBlock.includes('aspect-ratio'),
    '.vapor-app-frame must not contain aspect-ratio (replaced by dvh height, D-1)',
  )
})

// ---- T8.1-03: max-width centering is retained ----

test('T8.1-03a: .vapor-app-frame retains max-width constraint', () => {
  assert.ok(
    indexCss.includes('max-width: 26rem'),
    '.vapor-app-frame must retain max-width: 26rem for the narrow card column',
  )
})

test('T8.1-03b: .vapor-app-frame retains full-width base', () => {
  assert.ok(
    indexCss.includes('width: 100%'),
    '.vapor-app-frame must keep width: 100% so it fills narrower-than-26rem viewports',
  )
})

// ---- T8.1-04: 44×44 px (min-h-11) touch targets on interactive elements ----

test('T8.1-04a: LobbyView tab buttons have min-h-11 touch target', () => {
  assert.ok(
    lobbyView.includes('min-h-11'),
    'LobbyView mode-tab buttons must include min-h-11 to meet 44 px touch-target requirement',
  )
})

test('T8.1-04b: RoomView copy-room-ID button has min-h-11 touch target', () => {
  assert.ok(
    roomView.includes('min-h-11'),
    'RoomView copy-room-ID button must include min-h-11 to meet 44 px touch-target requirement',
  )
})

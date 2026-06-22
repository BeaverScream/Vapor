import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LAYOUT_MODE_KEY, LAYOUT_MODES, isValidLayoutMode } from '../src/lib/layoutMode.ts'

const FRONTEND_SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const BACKEND_SRC = new URL('../../backend/src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function collectTsFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(full))
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

// Mirrors the resolveMode logic from useLayoutMode.ts without requiring React/DOM
function resolveMode(capable, storage) {
  if (!capable) return 'mobile'
  try {
    const stored = storage.getItem(LAYOUT_MODE_KEY)
    if (isValidLayoutMode(stored)) return stored
  } catch {
    // storage unavailable
  }
  return 'desktop'
}

// ---- T8.6-04: localStorage persistence ----

test('T8.6-04a: isValidLayoutMode accepts all defined layout modes', () => {
  for (const mode of LAYOUT_MODES) {
    assert.equal(isValidLayoutMode(mode), true, `expected '${mode}' to be a valid layout mode`)
  }
})

test('T8.6-04b: isValidLayoutMode rejects unknown and non-string values', () => {
  assert.equal(isValidLayoutMode('tablet'), false)
  assert.equal(isValidLayoutMode(''), false)
  assert.equal(isValidLayoutMode(null), false)
  assert.equal(isValidLayoutMode(undefined), false)
  assert.equal(isValidLayoutMode(42), false)
  assert.equal(isValidLayoutMode({}), false)
})

test('T8.6-04c: LAYOUT_MODE_KEY is the expected storage key', () => {
  assert.equal(LAYOUT_MODE_KEY, 'vapor.layoutMode')
})

test('T8.6-04d: stored desktop preference is returned on a desktop-capable device', () => {
  const storage = { getItem: (k) => (k === LAYOUT_MODE_KEY ? 'desktop' : null) }
  assert.equal(resolveMode(true, storage), 'desktop')
})

test('T8.6-04e: stored mobile preference is honoured on a desktop-capable device', () => {
  const storage = { getItem: (k) => (k === LAYOUT_MODE_KEY ? 'mobile' : null) }
  assert.equal(resolveMode(true, storage), 'mobile')
})

test('T8.6-04f: no stored preference on desktop-capable device defaults to desktop', () => {
  const storage = { getItem: () => null }
  assert.equal(resolveMode(true, storage), 'desktop')
})

test('T8.6-04g: a corrupt stored value is ignored and falls back to desktop on capable device', () => {
  const storage = { getItem: () => 'tablet' }
  assert.equal(resolveMode(true, storage), 'desktop')
})

test('T8.6-04h: storage read errors are caught and fall back to desktop on capable device', () => {
  const storage = { getItem: () => { throw new Error('storage blocked') } }
  assert.doesNotThrow(() => resolveMode(true, storage))
  assert.equal(resolveMode(true, storage), 'desktop')
})

// ---- T8.6-05: mobile viewport pinning ----

test('T8.6-05a: mode is always mobile when device is not desktop-capable', () => {
  const desktopStorage = { getItem: () => 'desktop' }
  assert.equal(
    resolveMode(false, desktopStorage),
    'mobile',
    'stored desktop preference must be ignored when viewport is below the breakpoint',
  )
})

test('T8.6-05b: no stored preference on narrow viewport also resolves to mobile', () => {
  const emptyStorage = { getItem: () => null }
  assert.equal(resolveMode(false, emptyStorage), 'mobile')
})

test('T8.6-05c: explicit stored mobile preference on narrow viewport resolves to mobile', () => {
  const storage = { getItem: () => 'mobile' }
  assert.equal(resolveMode(false, storage), 'mobile')
})

// ---- T8.6-10: isolation checks ----

test('T8.6-10a: LAYOUT_MODE_KEY is referenced only in layoutMode.ts and useLayoutMode.ts', () => {
  const hits = collectTsFiles(FRONTEND_SRC).filter((f) => {
    const content = readFileSync(f, 'utf8')
    return content.includes('LAYOUT_MODE_KEY')
  })
  for (const hit of hits) {
    const normalised = hit.replace(/\\/g, '/')
    assert.ok(
      normalised.endsWith('layoutMode.ts') || normalised.endsWith('useLayoutMode.ts'),
      `LAYOUT_MODE_KEY must only appear in layoutMode.ts or useLayoutMode.ts, found in: ${normalised}`,
    )
  }
})

test('T8.6-10b: backend contains no reference to layoutMode', () => {
  for (const file of collectTsFiles(BACKEND_SRC)) {
    const content = readFileSync(file, 'utf8')
    assert.ok(
      !content.includes('layoutMode'),
      `backend must not reference layoutMode (layout preference is client-only); found in: ${file}`,
    )
  }
})

test('T8.6-10c: AvatarStack has been fully removed from frontend source', () => {
  for (const file of collectTsFiles(FRONTEND_SRC)) {
    const content = readFileSync(file, 'utf8')
    assert.ok(
      !content.includes('AvatarStack'),
      `AvatarStack must be fully removed from the codebase; found reference in: ${file}`,
    )
  }
})

test('T8.6-10d: socket client and WebRTC mesh do not reference layout mode', () => {
  const allFiles = collectTsFiles(FRONTEND_SRC)
  const socketClient = allFiles.find((f) => f.includes('room-socket-client'))
  const webrtcMesh = allFiles.find((f) => f.includes('webrtc-chat-mesh'))

  for (const file of [socketClient, webrtcMesh]) {
    if (!file) continue
    const content = readFileSync(file, 'utf8')
    assert.ok(
      !content.includes('layoutMode') && !content.includes('LAYOUT_MODE_KEY'),
      `layout preference must not appear in the socket/WebRTC layer; found in: ${file}`,
    )
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_THEME, THEME_IDS, isValidThemeId } from '../src/lib/theme.ts'

// Mirrors useTheme.ts's readStoredTheme: validate against the allowlist,
// falling back to DEFAULT_THEME on anything missing/corrupt — without
// requiring a DOM/sessionStorage environment.
function readFromStorage(storage, key) {
  const stored = storage.get(key)
  return isValidThemeId(stored) ? stored : DEFAULT_THEME
}

test('T7.2-01: isValidThemeId accepts exactly the THEME_IDS allowlist', () => {
  for (const id of THEME_IDS) {
    assert.equal(isValidThemeId(id), true, `expected '${id}' to be valid`)
  }
})

test('T7.2-01: isValidThemeId rejects empty string, casing variants, and retired ids', () => {
  assert.equal(isValidThemeId(''), false)
  assert.equal(isValidThemeId('LIGHT'), false)
  assert.equal(isValidThemeId('mist'), false)
  assert.equal(isValidThemeId('neon'), false)
})

test('T7.2-01: isValidThemeId rejects non-string types', () => {
  assert.equal(isValidThemeId(42), false)
  assert.equal(isValidThemeId(null), false)
  assert.equal(isValidThemeId(undefined), false)
  assert.equal(isValidThemeId({}), false)
})

test('T7.2-01: isValidThemeId rejects trailing-space variants', () => {
  assert.equal(isValidThemeId('blue '), false)
})

test('T7.2-02: a valid id written to storage reads back equal', () => {
  for (const id of THEME_IDS) {
    const storage = new Map([['vapor.theme', id]])
    assert.equal(readFromStorage(storage, 'vapor.theme'), id)
  }
})

test('T7.2-02: a malformed stored value resolves to DEFAULT_THEME', () => {
  const storage = new Map([['vapor.theme', 'mist']])
  assert.equal(readFromStorage(storage, 'vapor.theme'), DEFAULT_THEME)
})

test('T7.2-02: an absent stored value resolves to DEFAULT_THEME', () => {
  const storage = new Map()
  assert.equal(readFromStorage(storage, 'vapor.theme'), DEFAULT_THEME)
})

test('T7.2-02: a corrupt (non-string) stored value resolves to DEFAULT_THEME without throwing', () => {
  const storage = new Map([['vapor.theme', 42]])
  assert.doesNotThrow(() => readFromStorage(storage, 'vapor.theme'))
  assert.equal(readFromStorage(storage, 'vapor.theme'), DEFAULT_THEME)
})

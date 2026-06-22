import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// T8.4-06: Zero-persistence compliance for browser notifications.
// useNotifications must never write to localStorage/sessionStorage or include
// notification state in any socket payload.

const SRC_DIR = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

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

const sourceFiles = collectTsFiles(SRC_DIR)

test('T8.4-06a: useNotifications module must not write to localStorage or sessionStorage', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile, 'useNotifications.ts must exist in frontend/src')

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(!content.includes('localStorage'), 'useNotifications must not reference localStorage')
  assert.ok(!content.includes('sessionStorage'), 'useNotifications must not reference sessionStorage')
})

test('T8.4-06b: useNotifications module must not reference any socket emit or socket payload', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(!content.includes('socket.emit'), 'useNotifications must not emit socket events')
  assert.ok(!content.includes('socket.on'), 'useNotifications must not listen to socket events')
  assert.ok(!content.includes('payload'), 'useNotifications must not construct socket payloads')
})

test('T8.4-06c: useNotifications module must not persist permission state (no write to storage of any kind)', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  const storageWritePatterns = [
    'setItem',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'cookie',
    'document.cookie',
  ]
  for (const pattern of storageWritePatterns) {
    assert.ok(
      !content.includes(pattern),
      `useNotifications must not use storage API: ${pattern}`,
    )
  }
})

test('T8.4-06d: no frontend source file sends notification permission state over the socket', () => {
  const bannedPatterns = [
    'notification.*emit',
    'Notification.permission.*emit',
    'notif.*socket',
  ]

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8')
    for (const pattern of bannedPatterns) {
      const regex = new RegExp(pattern, 'i')
      assert.ok(
        !regex.test(content),
        `${file} must not send notification state over socket (matched: ${pattern})`,
      )
    }
  }
})

test('T8.4-06e: useNotifications only fires Notification when document.hidden is true (guard present)', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes('document.hidden'),
    'useNotifications must check document.hidden before firing a notification',
  )
})

test('T8.4-06f: useNotifications guards against environments without the Notification API', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes("typeof Notification") || content.includes("'Notification' in"),
    'useNotifications must guard for environments without the Notification API',
  )
})

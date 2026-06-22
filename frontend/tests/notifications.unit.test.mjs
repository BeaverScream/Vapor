import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

// T8.4-02: requestPermission only invokes Notification.requestPermission() when permission is 'default'
test('T8.4-02: requestPermission noops when permission is not default', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile, 'useNotifications.ts must exist in frontend/src')

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes("!== 'default'") || content.includes('!== "default"'),
    'requestPermission must guard with !== "default" to noop when permission is already granted or denied',
  )
})

// T8.4-03: notifyNewMessage only fires when Notification.permission === 'granted'
test('T8.4-03: notifyNewMessage does not fire unless permission is granted', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes("!== 'granted'") || content.includes('!== "granted"'),
    'notifyNewMessage must early-return when Notification.permission is not "granted"',
  )
})

// T8.4-04: notifyNewMessage is suppressed when the tab is in the foreground (document.hidden is false)
test('T8.4-04: notifyNewMessage suppressed when document.hidden is false', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes('!document.hidden'),
    'notifyNewMessage must early-return via !document.hidden to suppress notifications when tab is visible',
  )
})

// T8.4-05: rapid messages produce only one notification via browser tag deduplication
test('T8.4-05: Notification is constructed with tag for browser-level deduplication', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes('vapor-new-message'),
    'Notification must use tag "vapor-new-message" so rapid messages collapse into a single browser notification',
  )
  assert.ok(
    content.includes('tag'),
    'Notification options object must include the tag property',
  )
})

// T8.4-03 supplemental: generic notification body (no message content leaked)
test('T8.4-03 supplemental: notification body is generic — no message content', () => {
  const notifFile = sourceFiles.find((f) => f.includes('useNotifications'))
  assert.ok(notifFile)

  const content = readFileSync(notifFile, 'utf8')
  assert.ok(
    content.includes('A new message arrived'),
    'notification body must be a generic string, not derived from message content',
  )
})

// T8.4-03 supplemental: onNewMessage callback in webrtc-chat-mesh does not embed notification logic
test('T8.4-03 supplemental: WebRTC mesh accepts a callback and does not import Notification API directly', () => {
  const meshFile = sourceFiles.find((f) => f.includes('webrtc-chat-mesh'))
  assert.ok(meshFile, 'webrtc-chat-mesh.ts must exist')

  const content = readFileSync(meshFile, 'utf8')
  assert.ok(
    !content.includes('new Notification('),
    'webrtc-chat-mesh must not create Notification objects directly — it must delegate via callback',
  )
  assert.ok(
    content.includes('onNewMessage'),
    'webrtc-chat-mesh must accept an onNewMessage callback to decouple notification logic',
  )
})

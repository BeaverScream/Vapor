/**
 * Chat history persistence tests (VP-10.4 / §1.1 Chat History).
 *
 * These tests cover the sessionStorage-backed chat persistence feature:
 * history must survive an involuntary disconnect/reload, must be cleared on
 * terminal events, and the reconnect dedup guarantees must hold.
 */
import { test, expect } from '@playwright/test'
import { createRoom, joinRoom, sendMessage, waitForWebRTC, getChatHistoryKeys, BASE_URL } from './helpers'

test.describe('chat persistence', () => {
  test('chat history is restored after involuntary disconnect (page reload) (VP-10.4 T10.4-01/07)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })

      // Wait for WebRTC data channel to open so messages can be delivered
      await waitForWebRTC(hostPage, 1)
      await waitForWebRTC(guestPage, 1)

      const msg = 'Hello before reload'
      await sendMessage(hostPage, msg)

      // Guest receives the message
      await expect(guestPage.getByText(msg)).toBeVisible({ timeout: 8_000 })

      // Reload host tab — simulates involuntary TCP drop (no explicit leave)
      await hostPage.reload()

      // Host auto-reconnects (reconnecting → room screen)
      await expect(hostPage.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({
        timeout: 12_000,
      })

      // Chat history is restored — previously sent message is back in the feed
      await expect(hostPage.getByText(msg)).toBeVisible({ timeout: 5_000 })

      // sessionStorage still holds the chat entry
      const keys = await getChatHistoryKeys(hostPage)
      expect(keys.some((k) => k.includes(roomId))).toBe(true)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('chat history is cleared after explicit leave (VP-10.4 T10.4-02)', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await waitForWebRTC(hostPage, 1)

      await sendMessage(hostPage, 'Message before leave')
      // Confirm message appears (chat entry now in sessionStorage)
      await expect(hostPage.getByText('Message before leave')).toBeVisible()

      // Guest leaves explicitly
      await guestPage.getByRole('button', { name: /Leave room/i }).click()
      await expect(guestPage.locator('#nickname-input')).toBeVisible({ timeout: 5_000 })

      // Guest's sessionStorage chat entry must be gone
      const keys = await getChatHistoryKeys(guestPage)
      expect(keys.length).toBe(0)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('chat history is cleared when room is destroyed (VP-10.4 T10.4-05)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await waitForWebRTC(guestPage, 1)

      // Guest sends a message so a chat history entry is created
      await sendMessage(guestPage, 'From Bob')
      await expect(guestPage.getByText('From Bob')).toBeVisible()

      // Host leaves — destroys the room (reason: host_left)
      await hostPage.getByRole('button', { name: /Leave room/i }).click()

      // Guest receives room_destroyed → onRoomDestroyed clears chat history
      await expect(guestPage.getByText('Room ended')).toBeVisible({ timeout: 8_000 })

      // sessionStorage chat key must be gone
      const keys = await getChatHistoryKeys(guestPage)
      expect(keys.length).toBe(0)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('stale reconnect token resolves gracefully — app returns to lobby (VP-10.4 T10.4-03/04)', async ({
    page,
  }) => {
    await page.goto(BASE_URL)

    // Inject a plausible but non-existent session into sessionStorage
    await page.evaluate((key: string) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          roomId: 'nonexistent-room-id-e2e',
          reconnectToken: 'invalid-token-that-wont-match',
        }),
      )
    }, 'vapor.reconnect.session')

    // Reload — the app will attempt auto-resume and fail
    await page.reload()

    // App must not hang on the reconnecting spinner forever;
    // ROOM_NOT_FOUND during auto-resume resets the state to lobby.
    // 25s: WebSocket handshake can be slow when the backend event loop is under
    // load from accumulated connections of prior tests in a full-suite run.
    await expect(page.locator('#nickname-input')).toBeVisible({ timeout: 25_000 })
    // Session storage must be cleared after the failed resume
    const session = await page.evaluate((key: string) => sessionStorage.getItem(key), 'vapor.reconnect.session')
    expect(session).toBeNull()
  })

  test('reconnected participant sees no duplicate messages (VP-10.4 T10.4-06)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await waitForWebRTC(hostPage, 1)

      await sendMessage(hostPage, 'Before reload')
      await expect(hostPage.getByText('Before reload')).toBeVisible()

      // Reload host (involuntary disconnect + reconnect)
      await hostPage.reload()
      await expect(hostPage.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({
        timeout: 12_000,
      })

      // Count occurrences of the pre-reload message — must appear exactly once
      const count = await hostPage.getByText('Before reload').count()
      expect(count).toBe(1)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })
})

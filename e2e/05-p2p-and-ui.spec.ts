/**
 * P2P messaging and UI reliability tests.
 *
 * VP-10.2 T10.2-04: Guest↔guest messaging after host disconnects
 *   (irreducible: requires a live WebRTC media path)
 *
 * VP-10.3 T10.3-01b: Room lifetime timer stays visible while user types
 *   (irreducible: requires real setInterval + focus/paint)
 *
 * VP-10.3 T10.3-02: Desktop layout — scroll bar on chat container, not page
 *   (irreducible: requires real DOM layout engine with computed flex heights)
 */
import { test, expect } from '@playwright/test'
import { createRoom, joinRoom, waitForWebRTC, sendMessage } from './helpers'

test.describe('p2p messaging and UI reliability', () => {
  test('guest↔guest messaging works after host TCP disconnect (VP-10.2 T10.2-04)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guest1Ctx = await browser.newContext()
    const guest2Ctx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guest1Page = await guest1Ctx.newPage()
      const guest2Page = await guest2Ctx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guest1Page, { roomId, nickname: 'Bob' })
      await joinRoom(guest2Page, { roomId, nickname: 'Carol' })

      // Wait for full mesh: host has 2 peers, each guest has 2 peers
      await waitForWebRTC(hostPage, 2)
      await waitForWebRTC(guest1Page, 2)
      await waitForWebRTC(guest2Page, 2)

      // Host disconnects (TCP drop)
      await hostCtx.close()

      // Guests lose the host channel — each should settle at 1 remaining peer
      await waitForWebRTC(guest1Page, 1)
      await waitForWebRTC(guest2Page, 1)

      // VP-10.2 fix: guest1↔guest2 mesh was repaired by onPeerLeft calling syncPeers
      const g2gMsg = 'Hi from Bob to Carol after Alice left'
      await sendMessage(guest1Page, g2gMsg)

      // Guest2 receives the message via the repaired direct data channel
      await expect(guest2Page.getByText(g2gMsg)).toBeVisible({ timeout: 12_000 })
    } finally {
      await guest1Ctx.close()
      await guest2Ctx.close()
    }
  })

  test('room lifetime chip stays visible while typing in chat input (VP-10.3 T10.3-01b)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })

      // The RoomLifetimeChip is rendered in the room view
      const chip = guestPage.getByText(/Ends in/)
      await expect(chip).toBeVisible({ timeout: 5_000 })

      // Focus the chat input (this previously caused the chip to unmount)
      const chatInput = guestPage.locator('#chat-input, #chat-input-desktop').first()
      await chatInput.click()
      await guestPage.keyboard.type('typing something...')

      // Chip must remain visible while input is focused (VP-10.3 guard removed)
      await expect(chip).toBeVisible()

      // Blur the input — chip must still be visible
      await chatInput.blur()
      await expect(chip).toBeVisible()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('chat scroll bar is on the container, not the page, in desktop mode (VP-10.3 T10.3-02)', async ({
    browser,
  }) => {
    // Desktop mode is the default for the 1280-wide viewport in playwright.config.ts
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await waitForWebRTC(hostPage, 1)

      // Send enough messages to overflow the chat feed
      for (let i = 1; i <= 30; i++) {
        await sendMessage(hostPage, `Message ${i}`)
        // Guest receives each message; a small pause prevents send-buffer overflow
        if (i % 10 === 0) await hostPage.waitForTimeout(100)
      }

      // Wait for the last message to appear in host's own feed (outgoing messages
      // are added to state immediately, so no WebRTC delay needed here)
      await expect(hostPage.getByText('Message 30')).toBeVisible({ timeout: 8_000 })

      // Desktop layout fix: <main> uses h-dvh so the page itself must NOT scroll
      const pageScrollable = await hostPage.evaluate(() => {
        const el = document.documentElement
        return el.scrollHeight > el.clientHeight
      })
      expect(pageScrollable).toBe(false)

      // The message feed container (overflow-y-auto) must be the scroll target.
      // In desktop mode the feed is a direct .overflow-y-auto div containing the
      // message list; there is no explicit aria-label on the chat column div.
      const feedScrollable = await hostPage.evaluate(() => {
        const feeds = Array.from(document.querySelectorAll('.overflow-y-auto'))
        // Pick the tallest scrollable candidate — the message feed
        return feeds.some((el) => el.scrollHeight > el.clientHeight)
      })
      expect(feedScrollable).toBe(true)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })
})

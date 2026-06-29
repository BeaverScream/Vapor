/**
 * Room lifecycle tests (§6, §6.0, §6.3).
 * Each test targets a distinct lifecycle transition.
 */
import { test, expect } from '@playwright/test'
import { createRoom, joinRoom } from './helpers'

test.describe('lifecycle', () => {
  test('host voluntary leave destroys room — guest sees host_left message (§6 rule 3)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await expect(hostPage.getByText('2 participants')).toBeVisible({ timeout: 8_000 })

      await hostPage.getByRole('button', { name: /Leave room/i }).click()

      await expect(guestPage.getByText('Room ended')).toBeVisible({ timeout: 8_000 })
      await expect(guestPage.getByText(/Host left the room/)).toBeVisible()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('guest voluntary leave decrements count and emits system message (§6 rule 4)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await expect(hostPage.getByText('2 participants')).toBeVisible({ timeout: 8_000 })

      await guestPage.getByRole('button', { name: /Leave room/i }).click()

      await expect(hostPage.getByText('1 participant')).toBeVisible({ timeout: 8_000 })
      // System message: "<name> left" when reason is "leave"
      await expect(hostPage.getByText('Bob left')).toBeVisible()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('guest TCP disconnect emits peer_left immediately — not deferred to grace expiry (VP-10.1 / §6.0)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await expect(hostPage.getByText('2 participants')).toBeVisible({ timeout: 8_000 })

      // Close the context — no graceful leave, simulates TCP disconnect
      await guestCtx.close()

      // Host must see the participant count drop immediately (peer_left with reason: disconnect)
      await expect(hostPage.getByText('1 participant')).toBeVisible({ timeout: 8_000 })
      // System message: "<name> disconnected" when reason is "disconnect"
      await expect(hostPage.getByText('Bob disconnected')).toBeVisible()
    } finally {
      await hostCtx.close()
    }
  })

  test('host TCP disconnect shows reconnect grace banner to guest (§6 rule 5)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await expect(guestPage.getByText('2 participants')).toBeVisible({ timeout: 8_000 })

      await hostCtx.close()

      // roomStatus text shows the grace banner
      await expect(
        guestPage.getByText('Host disconnected. Waiting for host to reconnect…'),
      ).toBeVisible({ timeout: 8_000 })
    } finally {
      await guestCtx.close()
    }
  })

  test('kick removes participant — kicked guest sees removal message (§6 rule 9)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await expect(hostPage.getByText('2 participants')).toBeVisible({ timeout: 8_000 })

      // Desktop layout has the participant panel open by default; click Remove directly
      await hostPage.getByRole('button', { name: /Remove Bob from room/i }).click()

      // Kicked guest is shown the kicked-from-room screen
      await expect(guestPage.getByText(/removed from this room/i)).toBeVisible({ timeout: 8_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('solo timer chip is visible when host is the only participant (§6 rule 8)', async ({
    page,
  }) => {
    await createRoom(page, { nickname: 'Alice' })
    // SoloWaitingChip renders "Solo room expires if no guest joins in <countdown>"
    await expect(page.getByText(/Solo room expires if no guest joins in/)).toBeVisible({
      timeout: 5_000,
    })
  })

  test('join_room is rejected when liveCount is zero (§6.3)', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const newJoinerCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()
      const joinerPage = await newJoinerCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })
      await expect(hostPage.getByText('2 participants')).toBeVisible({ timeout: 8_000 })

      // TCP-drop both participants — liveCount drops to 0
      await hostCtx.close()
      await guestCtx.close()

      // Small wait for the backend to process both disconnects
      await joinerPage.waitForTimeout(600)

      await joinerPage.goto('http://localhost:5173')
      await joinerPage.getByRole('button', { name: 'Join', exact: true }).click()
      await joinerPage.fill('#room-id-input', roomId)
      await joinerPage.fill('#nickname-input', 'Charlie')
      await joinerPage.getByRole('button', { name: /Join room/i }).click()

      // Server responds with ROOM_NOT_FOUND (masks grace-window state)
      const alert = joinerPage.getByRole('alert')
      await expect(alert).toBeVisible({ timeout: 8_000 })
    } finally {
      await newJoinerCtx.close()
    }
  })
})

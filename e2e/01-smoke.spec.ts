/**
 * Smoke suite — basic happy-path flows every build must pass.
 */
import { test, expect } from '@playwright/test'
import { createRoom, joinRoom, BASE_URL } from './helpers'

test.describe('smoke', () => {
  test('create room renders room UI with expected elements', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.fill('#nickname-input', 'Alice')
    await page.getByRole('button', { name: /Create room/i }).click()

    await expect(page.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({ timeout: 10_000 })
    // Room ID chip appears as #<id>
    await expect(page.getByText(/#[a-zA-Z0-9-]+/).first()).toBeVisible()
    // One live participant on entry; no reconnecting slots are held.
    await expect(page.getByText('1 connected')).toBeVisible()
    // Solo timer chip: "Solo room expires if no guest joins in …"
    await expect(page.getByText(/Solo room expires if no guest joins in/)).toBeVisible()
    // Room lifetime chip: "Ends in …"
    await expect(page.getByText(/Ends in/)).toBeVisible()
    // Leave button present
    await expect(page.getByRole('button', { name: /Leave room/i })).toBeVisible()
  })

  test('second participant joins and both see 2 connected', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })
      await joinRoom(guestPage, { roomId, nickname: 'Bob' })

      await expect(hostPage.getByText('2 connected')).toBeVisible({ timeout: 8_000 })
      await expect(guestPage.getByText('2 connected')).toBeVisible({ timeout: 8_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('leaving room returns to lobby and clears session token', async ({ page }) => {
    await createRoom(page, { nickname: 'Alice' })
    await page.getByRole('button', { name: /Leave room/i }).click()

    // Lobby is back — lobby form inputs are the same in both layout modes
    await expect(page.locator('#nickname-input')).toBeVisible({ timeout: 5_000 })

    const session = await page.evaluate((key: string) =>
      sessionStorage.getItem(key),
      'vapor.reconnect.session',
    )
    expect(session).toBeNull()
  })
})

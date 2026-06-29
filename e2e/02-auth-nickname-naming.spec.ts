/**
 * Auth, nickname, and room-naming rules (§4, §4.1, §6.4).
 * Each test targets a distinct validation path with no redundancy against
 * the smoke suite.
 */
import { test, expect } from '@playwright/test'
import { createRoom, getLobbyError, BASE_URL } from './helpers'

test.describe('auth / nickname / room naming', () => {
  test('joining with wrong password is rejected with an error (§4)', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice', password: 'correct-pass' })

      await guestPage.goto(BASE_URL)
      await guestPage.getByRole('button', { name: 'Join', exact: true }).click()
      await guestPage.fill('#room-id-input', roomId)
      await guestPage.fill('#password-input', 'wrong-pass')
      await guestPage.fill('#nickname-input', 'Bob')
      await guestPage.getByRole('button', { name: /Join room/i }).click()

      const error = await getLobbyError(guestPage)
      expect(error).toBeTruthy()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('joining with correct password enters the room and shows Protected badge (§4)', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice', password: 'secret' })

      await guestPage.goto(BASE_URL)
      await guestPage.getByRole('button', { name: 'Join', exact: true }).click()
      await guestPage.fill('#room-id-input', roomId)
      await guestPage.fill('#password-input', 'secret')
      await guestPage.fill('#nickname-input', 'Bob')
      await guestPage.getByRole('button', { name: /Join room/i }).click()

      await expect(guestPage.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({
        timeout: 10_000,
      })
      await expect(guestPage.getByText('Protected')).toBeVisible()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('joining a nonexistent room shows an error (§8 ROOM_NOT_FOUND)', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await page.fill('#room-id-input', 'this-room-does-not-exist-xyz')
    await page.fill('#nickname-input', 'Alice')
    await page.getByRole('button', { name: /Join room/i }).click()

    const error = await getLobbyError(page)
    expect(error).toBeTruthy()
  })

  test('nickname shorter than 3 chars is rejected (§4.1)', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.fill('#nickname-input', 'AB')
    await page.getByRole('button', { name: /Create room/i }).click()

    const error = await getLobbyError(page)
    expect(error).toBeTruthy()
  })

  test('duplicate nickname in the same room is rejected (§4.1)', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      const roomId = await createRoom(hostPage, { nickname: 'Alice' })

      await guestPage.goto(BASE_URL)
      await guestPage.getByRole('button', { name: 'Join', exact: true }).click()
      await guestPage.fill('#room-id-input', roomId)
      await guestPage.fill('#nickname-input', 'Alice') // same as host
      await guestPage.getByRole('button', { name: /Join room/i }).click()

      const error = await getLobbyError(guestPage)
      expect(error).toBeTruthy()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('joining by room name resolves to the correct room (§6.4)', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    try {
      const hostPage = await hostCtx.newPage()
      const guestPage = await guestCtx.newPage()

      await createRoom(hostPage, { nickname: 'Alice', roomName: 'e2e-test-room' })

      // Guest uses the human-readable room name, not the raw roomId
      await guestPage.goto(BASE_URL)
      await guestPage.getByRole('button', { name: 'Join', exact: true }).click()
      await guestPage.fill('#room-id-input', 'e2e-test-room')
      await guestPage.fill('#nickname-input', 'Bob')
      await guestPage.getByRole('button', { name: /Join room/i }).click()

      await expect(guestPage.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({
        timeout: 10_000,
      })
      // Room name appears in the header
      await expect(guestPage.getByText('e2e-test-room')).toBeVisible()
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('creating a room with a duplicate name is rejected (§6.4)', async ({ browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    try {
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()

      await createRoom(page1, { nickname: 'Alice', roomName: 'unique-room-e2e' })

      await page2.goto(BASE_URL)
      await page2.fill('#room-name-input', 'unique-room-e2e')
      await page2.fill('#nickname-input', 'Bob')
      await page2.getByRole('button', { name: /Create room/i }).click()

      const error = await getLobbyError(page2)
      expect(error).toBeTruthy()
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

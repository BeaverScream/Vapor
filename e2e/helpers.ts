import { type Page, expect } from '@playwright/test'

export const BASE_URL = 'http://localhost:5173'
export const RECONNECT_SESSION_KEY = 'vapor.reconnect.session'
export const CHAT_HISTORY_PREFIX = 'vapor.chat:'

/**
 * Creates a room from a fresh page and returns the roomId extracted from
 * sessionStorage. The caller is responsible for navigating to BASE_URL first.
 */
export async function createRoom(
  page: Page,
  opts: { nickname: string; password?: string; roomName?: string },
): Promise<string> {
  await page.goto(BASE_URL)

  const createBtn = page.getByRole('button', { name: 'Create', exact: true })
  if ((await createBtn.getAttribute('aria-pressed')) !== 'true') {
    await createBtn.click()
  }

  if (opts.roomName) await page.fill('#room-name-input', opts.roomName)
  if (opts.password) await page.fill('#password-input', opts.password)
  await page.fill('#nickname-input', opts.nickname)
  await page.getByRole('button', { name: /Create room/i }).click()

  // Desktop layout uses #chat-input-desktop; mobile uses #chat-input
  await expect(page.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({
    timeout: 10_000,
  })

  const session = await page.evaluate((key: string) => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { roomId?: string }) : null
    } catch {
      return null
    }
  }, RECONNECT_SESSION_KEY)

  if (!session?.roomId) throw new Error('roomId not found in sessionStorage after create')
  return session.roomId
}

/**
 * Joins an existing room from a fresh page. Waits until the room screen is
 * visible before returning.
 */
export async function joinRoom(
  page: Page,
  opts: { roomId: string; nickname: string; password?: string },
): Promise<void> {
  await page.goto(BASE_URL)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.fill('#room-id-input', opts.roomId)
  if (opts.password) await page.fill('#password-input', opts.password)
  await page.fill('#nickname-input', opts.nickname)
  await page.getByRole('button', { name: /Join room/i }).click()
  await expect(page.locator('#chat-input, #chat-input-desktop').first()).toBeVisible({
    timeout: 10_000,
  })
}

/**
 * Waits until the WebRTC chat status text confirms N open data-channel
 * connections. chatStatusText emits "Private peer chat live with N connection(s)."
 */
export async function waitForWebRTC(page: Page, peerCount = 1, timeoutMs = 15_000): Promise<void> {
  const label =
    peerCount === 1
      ? 'Private peer chat live with 1 connection.'
      : `Private peer chat live with ${peerCount} connections.`
  await expect(page.getByText(label, { exact: true })).toBeVisible({ timeout: timeoutMs })
}

/** Fills the chat input (desktop or mobile) and submits via Enter. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#chat-input, #chat-input-desktop').first()
  await input.fill(text)
  await input.press('Enter')
}

/**
 * Returns the visible error text from the lobby role="alert" element, or null
 * if it does not appear within 5 s.
 */
export async function getLobbyError(page: Page, timeoutMs = 5_000): Promise<string | null> {
  try {
    const alert = page.getByRole('alert')
    await alert.waitFor({ state: 'visible', timeout: timeoutMs })
    return alert.textContent()
  } catch {
    return null
  }
}

/** Reads vapor.reconnect.session from the page's sessionStorage. */
export async function getStoredSession(
  page: Page,
): Promise<{ roomId: string; reconnectToken: string } | null> {
  return page.evaluate((key: string) => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { roomId: string; reconnectToken: string }) : null
    } catch {
      return null
    }
  }, RECONNECT_SESSION_KEY)
}

/** Returns all sessionStorage keys that start with vapor.chat: */
export async function getChatHistoryKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix: string) => Object.keys(sessionStorage).filter((k) => k.startsWith(prefix)),
    CHAT_HISTORY_PREFIX,
  )
}

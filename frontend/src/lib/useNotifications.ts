import { useCallback } from 'react'

export function useNotifications(): {
  requestPermission: () => void
  notifyNewMessage: () => void
} {
  const requestPermission = useCallback((): void => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'default') return
    void Notification.requestPermission()
  }, [])

  const notifyNewMessage = useCallback((): void => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    if (!document.hidden) return
    new Notification('New message', {
      body: 'A new message arrived in your Vapor room.',
      tag: 'vapor-new-message',
    })
  }, [])

  return { requestPermission, notifyNewMessage }
}

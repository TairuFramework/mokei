export function canNotify(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification !== 'undefined') await Notification.requestPermission()
}

export function showBrowserNotification(
  itemID: string,
  title: string,
  message: string,
  open: () => void,
): Notification | undefined {
  if (!canNotify()) return
  try {
    const notification = new Notification(title, { body: message, tag: itemID })
    notification.onclick = () => {
      window.focus()
      open()
    }
    return notification
  } catch {
    return undefined
  }
}

export function observeNotificationPermission(changed: () => void): () => void {
  let stopped = false
  let status: PermissionStatus | undefined
  if (navigator.permissions != null) {
    void navigator.permissions
      .query({ name: 'notifications' })
      .then((value) => {
        if (stopped) return
        status = value
        status.addEventListener('change', changed)
        changed()
      })
      .catch(() => {})
  }
  return () => {
    stopped = true
    status?.removeEventListener('change', changed)
  }
}

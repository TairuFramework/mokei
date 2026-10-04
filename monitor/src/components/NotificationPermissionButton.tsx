import { Button } from '@mantine/core'

import { usePresence } from '../presence/PresenceProvider.js'

export function NotificationPermissionButton() {
  const { canNotify, requestPermission } = usePresence()
  return (
    <Button
      size="xs"
      variant="white"
      disabled={
        canNotify || typeof Notification === 'undefined' || Notification.permission === 'denied'
      }
      onClick={() => {
        void requestPermission().catch(() => {})
      }}>
      {canNotify ? 'Notifications enabled' : 'Enable notifications'}
    </Button>
  )
}

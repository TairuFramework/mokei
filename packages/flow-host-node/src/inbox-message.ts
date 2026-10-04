import type { InboxItem } from '@mokei/flow-host'

export function inboxItemMessage(item: InboxItem): string {
  return item.kind === 'approval' ? 'Flow needs your approval' : 'Flow needs your input'
}

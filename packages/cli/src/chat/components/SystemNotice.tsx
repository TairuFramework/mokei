import { IconLine } from './IconLine.js'

export type SystemNoticeVariant = 'info' | 'warning' | 'error' | 'success'

export type SystemNoticeProps = {
  variant?: SystemNoticeVariant
  text: string
}

const COLOR: Record<SystemNoticeVariant, string> = {
  info: 'blue',
  warning: 'yellow',
  error: 'red',
  success: 'green',
}

const ICON: Record<SystemNoticeVariant, string> = {
  info: 'ℹ',
  warning: '!',
  error: '✗',
  success: '✓',
}

export function SystemNotice({ variant = 'info', text }: SystemNoticeProps) {
  return (
    <IconLine icon={ICON[variant]} color={COLOR[variant]}>
      {text}
    </IconLine>
  )
}

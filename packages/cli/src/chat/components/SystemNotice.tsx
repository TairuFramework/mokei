import { Box, Text } from 'ink'

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

export function SystemNotice({ variant = 'info', text }: SystemNoticeProps) {
  return (
    <Box>
      <Text color={COLOR[variant]}>[{variant}] </Text>
      <Text>{text}</Text>
    </Box>
  )
}

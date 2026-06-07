import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

export type IconLineProps = {
  icon: string
  color?: string
  dim?: boolean
  children: ReactNode
}

/**
 * Two-column line: a fixed narrow left column holding a single-character icon,
 * and a flexible right column whose text wraps full width. Continuation lines
 * hang-indent under the right column (a 2-cell gutter), keeping replies and
 * notices aligned without a wide label.
 */
export function IconLine({ icon, color, dim, children }: IconLineProps) {
  return (
    <Box>
      <Box flexShrink={0} width={2}>
        <Text color={color} dimColor={dim}>
          {icon}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text dimColor={dim}>{children}</Text>
      </Box>
    </Box>
  )
}

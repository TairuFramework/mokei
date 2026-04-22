import { Box, Text } from 'ink'

export type ToolResultCardProps = {
  name: string
  result?: string
  error?: string
}

export function ToolResultCard({ name, result, error }: ToolResultCardProps) {
  const isError = error != null
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'}>
      <Text color={isError ? 'red' : 'yellow'}>tool · {name}</Text>
      <Text>{isError ? error : result}</Text>
    </Box>
  )
}

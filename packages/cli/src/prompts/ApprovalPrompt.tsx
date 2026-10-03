import { ConfirmCard } from '@tejika/ui'
import { Box, Text, useApp } from 'ink'

export type ApprovalPromptProps = {
  tools: ReadonlyArray<string>
  onApprove: () => void
  onDeny: () => void
}

export function ApprovalPrompt({ tools, onApprove, onDeny }: ApprovalPromptProps) {
  return (
    <Box flexDirection="column">
      <Text bold>planned tools</Text>
      {tools.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        tools.map((tool) => <Text key={tool}>- {tool}</Text>)
      )}
      <ConfirmCard message="approve this run?" onConfirm={onApprove} onCancel={onDeny} />
    </Box>
  )
}

/** Runs an `ApprovalPrompt` inside `runInk`: reports the decision, then exits the app. */
export function ApprovalRunner({
  tools,
  onDone,
}: {
  tools: ReadonlyArray<string>
  onDone: (approved: boolean) => void
}) {
  const { exit } = useApp()
  const finish = (approved: boolean) => {
    onDone(approved)
    exit()
  }
  return (
    <ApprovalPrompt tools={tools} onApprove={() => finish(true)} onDeny={() => finish(false)} />
  )
}

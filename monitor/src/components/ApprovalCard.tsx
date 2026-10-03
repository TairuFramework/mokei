import { Button, Card, Group, Stack, Text, Title } from '@mantine/core'

type ApprovalCardProps = {
  plan: { tools: Array<string> }
  onApprove(): void
  onDeny(): void
}

export function ApprovalCard({ plan, onApprove, onDeny }: ApprovalCardProps) {
  return (
    <Card withBorder>
      <Stack>
        <Title order={2}>Approval requested</Title>
        <Text>{plan.tools.join(', ') || 'No tools'}</Text>
        <Group>
          <Button onClick={onApprove}>Approve</Button>
          <Button color="red" variant="light" onClick={onDeny}>
            Deny
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

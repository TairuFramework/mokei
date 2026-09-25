import { IconLine } from '@tejika/ui'

export type UserMessageProps = { text: string }

export function UserMessage({ text }: UserMessageProps) {
  return (
    <IconLine icon="›" color="cyan">
      {text}
    </IconLine>
  )
}

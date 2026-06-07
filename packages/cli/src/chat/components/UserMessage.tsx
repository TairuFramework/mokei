import { IconLine } from './IconLine.js'

export type UserMessageProps = { text: string }

export function UserMessage({ text }: UserMessageProps) {
  return (
    <IconLine icon="›" color="cyan">
      {text}
    </IconLine>
  )
}

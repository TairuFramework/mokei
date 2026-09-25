import { IconLine } from '@tejika/ui'

export type AssistantMessageProps = { text: string }

export function AssistantMessage({ text }: AssistantMessageProps) {
  return (
    <IconLine icon="●" color="green">
      {text}
    </IconLine>
  )
}

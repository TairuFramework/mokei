import { IconLine } from './IconLine.js'

export type AssistantStreamingTextProps = { text: string }

export function AssistantStreamingText({ text }: AssistantStreamingTextProps) {
  return (
    <IconLine icon="●" color="green">
      {text}
    </IconLine>
  )
}

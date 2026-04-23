export type SlashMessage = { kind: 'message'; text: string }
export type SlashCommand = { kind: 'command'; name: string; args: Array<string> }
export type SlashParsed = SlashMessage | SlashCommand

export type SlashCommandInfo = {
  name: string
  description: string
}

export const SLASH_COMMANDS: ReadonlyArray<SlashCommandInfo> = [
  { name: 'help', description: 'show available commands' },
  { name: 'model', description: 'pick or set the active model' },
  { name: 'context', description: 'manage MCP contexts (list/add/remove)' },
  { name: 'tools', description: 'enable or disable tools per context' },
  { name: 'quit', description: 'exit the chat' },
  { name: 'exit', description: 'exit the chat' },
]

export function matchSlashCommands(value: string): Array<SlashCommandInfo> {
  if (!value.startsWith('/')) return []
  const prefix = value.slice(1).split(/\s+/)[0] ?? ''
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix))
}

export function parseSlash(input: string): SlashParsed {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return { kind: 'message', text: trimmed }
  }
  const tokens = trimmed
    .slice(1)
    .split(/\s+/)
    .filter((t) => t.length > 0)
  const [name, ...args] = tokens
  return { kind: 'command', name: name ?? '', args }
}

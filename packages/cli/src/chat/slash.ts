export type SlashMessage = { kind: 'message'; text: string }
export type SlashCommand = { kind: 'command'; name: string; args: Array<string> }
export type SlashParsed = SlashMessage | SlashCommand

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

import type { TraceSummary } from '@mokei/host-protocol'

export function traceDisplayTitle(summary: TraceSummary): string {
  const label = summary.attributes.label
  if (typeof label === 'string') return label
  const flowID = summary.attributes['mokei.flow.id']
  if (summary.kind === 'flow' && typeof flowID === 'string') return flowID
  // A context's root span is `mcp.context`; the server it connects to names it better.
  const serverName = summary.attributes['mokei.server.name']
  if (summary.kind === 'context' && typeof serverName === 'string') return serverName
  return summary.name
}

export function traceSearchText(summary: TraceSummary): string {
  return [
    summary.name,
    summary.attributes.label,
    summary.attributes['mokei.flow.id'],
    summary.attributes['mokei.server.name'],
  ]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase()
}

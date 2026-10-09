import type { TraceSummary } from '@mokei/host-protocol'

export function traceDisplayTitle(summary: TraceSummary): string {
  const label = summary.attributes.label
  if (typeof label === 'string') return label
  const flowID = summary.attributes['flow.id']
  return summary.kind === 'flow' && typeof flowID === 'string' ? flowID : summary.name
}

export function traceSearchText(summary: TraceSummary): string {
  return [summary.name, summary.attributes.label, summary.attributes['flow.id']]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase()
}

import type { StoredSpan } from '@mokei/host-protocol'

export type SpanTreeNode = { span: StoredSpan; children: Array<SpanTreeNode> }

export function nestSpans(spans: Array<StoredSpan>): Array<SpanTreeNode> {
  const nodes = spans
    .toSorted((a, b) => a.startTime - b.startTime)
    .map((span): SpanTreeNode => ({ span, children: [] }))
  const ids = new Set(spans.map((span) => span.spanID))
  const children = new Map<string, Array<SpanTreeNode>>()
  const roots: Array<SpanTreeNode> = []
  for (const node of nodes) {
    const parentID = node.span.parentSpanID
    if (parentID == null || !ids.has(parentID)) {
      roots.push(node)
    } else {
      const siblings = children.get(parentID) ?? []
      siblings.push(node)
      children.set(parentID, siblings)
    }
  }
  const seen = new Set<SpanTreeNode>()
  const visit = (node: SpanTreeNode) => {
    seen.add(node)
    for (const child of children.get(node.span.spanID) ?? []) {
      if (seen.has(child)) continue
      node.children.push(child)
      visit(child)
    }
  }
  for (const root of roots) visit(root)
  // Flatten unreachable components so parent cycles cannot enter the tree.
  for (const node of nodes) {
    if (!seen.has(node)) roots.push(node)
  }
  return roots
}

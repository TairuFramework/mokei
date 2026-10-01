export function matchesAllow(toolID: string, globs: Array<string>): boolean {
  return globs.some((glob) => {
    const source = glob
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^:]*')
    return new RegExp(`^${source}$`).test(toolID)
  })
}

export function isAllowed(plan: Array<string>, globs: Array<string>): boolean {
  return plan.every((toolID) => matchesAllow(toolID, globs))
}

/** Sends a failure report to `onUnsupported` when given, else to stderr. */
export function report(
  onUnsupported: ((reason: string) => void) | undefined,
  reason: string,
): void {
  if (onUnsupported == null) {
    console.error(`[mokei/host-desktop] ${reason}`)
  } else {
    onUnsupported(reason)
  }
}

/** Encode the stable pagination boundary shared by trace index and reader. */
export function encodeTraceCursor(startTime: number, traceID: string): string {
  return Buffer.from(JSON.stringify([startTime, traceID])).toString('base64')
}

/** Decode a trace pagination boundary, rejecting malformed cursor payloads. */
export function decodeTraceCursor(cursor: string): [number, string] {
  const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== 'number' ||
    typeof decoded[1] !== 'string'
  ) {
    throw new Error('Invalid trace list cursor')
  }
  return decoded as [number, string]
}

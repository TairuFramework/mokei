// Decode the column once; nested JSON-looking strings are application data.
export function decodeJSONColumn<TValue>(value: TValue | string): TValue {
  return typeof value === 'string' ? (JSON.parse(value) as TValue) : value
}

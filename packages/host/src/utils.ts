export function filterEnv(
  env: Record<string, string | null | undefined> = {},
): Record<string, string> {
  return Object.entries(env).reduce(
    (acc, [key, value]) => {
      if (value != null) {
        acc[key] = value
      }
      return acc
    },
    {} as Record<string, string>,
  )
}

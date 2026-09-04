export type ProtectedResourceMetadataConfig = {
  resource: string
  authorizationServers: Array<string>
}

export function protectedResourceMetadataPath(resource: string): string {
  const u = new URL(resource)
  const suffix = u.pathname === '/' ? '' : u.pathname
  return `/.well-known/oauth-protected-resource${suffix}`
}

export function protectedResourceMetadataResponse(
  config: ProtectedResourceMetadataConfig,
): Response {
  return new Response(
    JSON.stringify({
      resource: config.resource,
      authorization_servers: config.authorizationServers,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

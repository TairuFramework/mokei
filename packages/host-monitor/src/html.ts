/**
 * Splice a secret token into served HTML as a global the monitor UI reads.
 * The token is JSON-encoded so a token value can never break out of the
 * <script> element. Additionally < and > are unicode-escaped so that even
 * pathological tokens containing "</script>" cannot close the injected
 * script block.
 */
export function injectToken(html: string, token: string): string {
  const safeJson = JSON.stringify(token).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const tag = `<script>window.__MOKEI_TOKEN__=${safeJson}</script>`
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${tag}${html}`
}

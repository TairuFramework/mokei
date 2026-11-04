import { canonicalResource, parseTokenStoreKey, revokeTokens } from '@mokei/http-client'
import { Command } from 'commander'

import { openTokenStore, type TokenStoreOptions } from '../auth-store.js'
import { addJSONOption, fail, printJSON, renderTable } from '../output.js'

type ListOptions = TokenStoreOptions & { json?: boolean }

type LogoutOptions = TokenStoreOptions & { clientId?: string; revoke: boolean; json?: boolean }

type SignIn = {
  resource: string
  clientID: string
  scopes: Array<string>
  issuer: string | null
  expiresAt: number | null
  refreshable: boolean
}

const SIGN_IN_COLUMNS = [
  { key: 'resource', label: 'RESOURCE' },
  { key: 'clientID', label: 'CLIENT' },
  { key: 'scopes', label: 'SCOPES' },
  { key: 'issuer', label: 'ISSUER' },
  { key: 'expires', label: 'EXPIRES' },
  { key: 'refresh', label: 'REFRESH' },
]

function formatExpiry(expiresAt: number | null): string {
  if (expiresAt == null) return '-'
  const date = new Date(expiresAt * 1000).toISOString()
  return expiresAt * 1000 <= Date.now() ? `${date} (expired)` : date
}

/** The sign-ins in a store, never their tokens. Keys this CLI did not write are skipped. */
async function readSignIns(options: TokenStoreOptions): Promise<Array<SignIn & { key: string }>> {
  const store = openTokenStore(options)
  const signIns: Array<SignIn & { key: string }> = []
  for (const key of await store.keys()) {
    const parts = parseTokenStoreKey(key)
    if (parts == null) continue
    const tokens = await store.get(key)
    if (tokens == null) continue
    signIns.push({
      key,
      resource: parts.resource,
      clientID: parts.clientID,
      scopes: parts.scopes,
      issuer: tokens.issuer ?? null,
      expiresAt: tokens.expiresAt ?? null,
      refreshable: tokens.refreshToken != null,
    })
  }
  return signIns.sort((a, b) => a.resource.localeCompare(b.resource))
}

async function runList(options: ListOptions): Promise<void> {
  try {
    const signIns = (await readSignIns(options)).map(({ key: _key, ...signIn }) => signIn)
    if (options.json) {
      printJSON(signIns)
      return
    }
    if (signIns.length === 0) {
      process.stdout.write('No stored sign-ins\n')
      return
    }
    renderTable(
      SIGN_IN_COLUMNS,
      signIns.map((signIn) => ({
        resource: signIn.resource,
        clientID: signIn.clientID,
        scopes: signIn.scopes.join(' ') || '-',
        issuer: signIn.issuer ?? '-',
        expires: formatExpiry(signIn.expiresAt),
        refresh: signIn.refreshable ? 'yes' : 'no',
      })),
    )
  } catch (error) {
    fail(error)
  }
}

type LogoutOutcome = {
  resource: string
  clientID: string
  scopes: Array<string>
  revocation: 'revoked' | 'skipped' | 'unsupported' | 'failed'
  detail?: string
}

async function runLogout(resource: string, options: LogoutOptions): Promise<void> {
  try {
    const canonical = canonicalResource(resource)
    const store = openTokenStore(options)
    const matches = (await readSignIns(options)).filter(
      (signIn) =>
        signIn.resource === canonical &&
        (options.clientId == null || signIn.clientID === options.clientId),
    )
    if (matches.length === 0) {
      throw new Error(
        `No stored sign-in for ${canonical}${options.clientId == null ? '' : ` with client ${options.clientId}`}`,
      )
    }
    const outcomes: Array<LogoutOutcome> = []
    for (const signIn of matches) {
      const outcome: LogoutOutcome = {
        resource: signIn.resource,
        clientID: signIn.clientID,
        scopes: signIn.scopes,
        revocation: 'skipped',
      }
      const tokens = await store.get(signIn.key)
      if (options.revoke && tokens != null) {
        try {
          const result = await revokeTokens({
            tokens,
            clientID: signIn.clientID,
            resource: signIn.resource,
          })
          if (result.status === 'revoked') {
            outcome.revocation = 'revoked'
            outcome.detail = result.revoked.join(', ')
          } else {
            outcome.revocation = 'unsupported'
            outcome.detail = result.reason
          }
        } catch (error) {
          outcome.revocation = 'failed'
          outcome.detail = error instanceof Error ? error.message : String(error)
        }
      }
      // Deleted whatever the revocation did: logging out must not leave a usable token behind.
      await store.delete(signIn.key)
      outcomes.push(outcome)
    }
    if (options.json) {
      printJSON(outcomes)
    } else {
      for (const outcome of outcomes) {
        const scopes = outcome.scopes.length > 0 ? ` [${outcome.scopes.join(' ')}]` : ''
        const detail = outcome.detail == null ? '' : `: ${outcome.detail}`
        process.stdout.write(
          `Signed out of ${outcome.resource} (${outcome.clientID}${scopes}); revocation ${outcome.revocation}${detail}\n`,
        )
      }
    }
    // The local sign-in is gone either way, but say so when the server may still honour it.
    if (outcomes.some((outcome) => outcome.revocation === 'failed')) process.exitCode = 1
  } catch (error) {
    fail(error)
  }
}

function withStoreOptions(command: Command): Command {
  return command
    .option('--keychain', 'use tokens stored in the OS keychain')
    .option('--tokens <path>', 'use tokens stored in this JSON file')
}

export function createAuthCommand(): Command {
  const auth = new Command('auth').description('List and remove stored OAuth sign-ins')

  const list = auth.command('list').description('List stored sign-ins (never their tokens)')
  addJSONOption(withStoreOptions(list)).action(runList)

  const logout = auth
    .command('logout')
    .description('Revoke (RFC 7009) and delete the stored sign-ins for a resource')
    .argument('<resource>', 'MCP resource URL the sign-in is for')
    .option('--client-id <id>', 'only the sign-in of this OAuth client')
    .option('--no-revoke', 'delete locally without revoking at the authorisation server')
  addJSONOption(withStoreOptions(logout)).action(runLogout)

  return auth
}

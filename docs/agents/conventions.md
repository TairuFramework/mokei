# Conventions

---

## 1. TypeScript Conventions

### Type Definitions
- **Always use `type` instead of `interface`** for all type definitions
- **Always use `Array<T>` instead of `T[]`** for array types
- **Never use `any` type** -- use `unknown`, `Record<string, unknown>`, or a more specific type
- Use union types and discriminated unions over enums
- Use descriptive generic type parameter names beyond single letters (e.g., `TData`, `TError`)
- Leverage conditional types and mapped types for complex transformations
- Use intersection types for composition

```typescript
// Correct
type ApiResponse<TData> = {
  data: TData
  errors: Array<ApiError>
}

// Incorrect
interface ApiResponse<T> {
  data: T
  errors: ApiError[]
}
```

### Class Conventions
- **Use ES private fields (`#field`), never the TypeScript `private` modifier**
- **Never use the TypeScript `readonly` modifier.** Use a `#field` for the value and expose a getter when external read access is needed -- this enforces immutability at runtime, not just at compile time
- Avoid the `protected` modifier; prefer composition over inheritance that relies on it
- Constructor params: single object parameter with a `ClassNameParams` type

```typescript
type ConnectionManagerParams = {
  transport: Transport
  maxRetries: number
}

class ConnectionManager {
  #transport: Transport
  #maxRetries: number

  constructor(params: ConnectionManagerParams) {
    this.#transport = params.transport
    this.#maxRetries = params.maxRetries
  }

  // Expose read-only access via a getter instead of `readonly`
  get maxRetries(): number {
    return this.#maxRetries
  }
}
```

```typescript
// Incorrect -- TS-only modifiers, no runtime enforcement
class ConnectionManager {
  private transport: Transport
  readonly maxRetries: number
}
```

### Naming
- Always use capital `ID` not `Id` (e.g., `threadID`, `spaceID`, `flowID`, `userID`)
- Apply the same pattern for similar abbreviations: `HTTP` not `Http`, `DID` not `Did`, `JWT` not `Jwt`
- Types use PascalCase, variables and functions use camelCase, constants use UPPER_SNAKE_CASE

### General Style
- Target ES2025 with strict mode enabled
- Use `const` assertions where appropriate
- Prefer template literals over string concatenation
- Export types alongside implementation when needed
- Use `type` keyword for type-only imports: `import type { Foo } from './foo.js'`

### Comments
- **Keep comments short.** No overly long comments -- include only the necessary context, minimal token count.
- Comment the *why*, not the *what*. Self-explanatory code needs no comment.
- No redundant comments that restate the code, no commented-out code, no decorative banners.
- **No plan/implementation-specific references** in code, comments, `describe`/`test` names, or identifiers -- no internal task numbers, plan item labels (e.g. `G7`, `Task 6`), or ticket IDs. Reference the durable concept or external spec (e.g. `SEP-2243`, `x-mcp-header`) instead; plan labels are ephemeral and meaningless once the plan is archived.

### Placeholder Values
- **NEVER use placeholder values to satisfy the type checker.** This is a MAJOR source of bugs that pass typecheck but fail at runtime.
- If a type expects a real value (UUID, URL, ID, token, etc.), provide a real one or refactor so the value is not required at that call site
- Do not write `{ id: '' }`, `{ url: 'TODO' }`, `{ token: 'xxx' }`, or similar just to make types compile
- If you genuinely cannot supply a real value, make the field optional in the type, use `null`/`undefined` explicitly, or throw -- do not lie to the type system

```typescript
// Incorrect -- passes typecheck, breaks at runtime
const user: User = { id: '', name: 'Alice' }

// Correct -- generate or accept a real value
const user: User = { id: crypto.randomUUID(), name: 'Alice' }

// Correct -- make field optional if absence is meaningful
type User = { id?: string; name: string }
```

---

## 2. Formatting

All repos use **Biome** for linting and formatting. Configuration lives in the repo root.

- **Indentation**: 2 spaces
- **Line width**: 100 characters
- **Quotes**: single quotes for strings, double quotes for JSX attributes
- **Trailing commas**: in all contexts
- **Semicolons**: as needed (not required everywhere)
- **Arrow functions**: always use parentheses -- `(param) => result`
- **JSX brackets**: same line
- **Imports**: Biome auto-organizes imports

Run `pnpm run lint` to format and lint all packages. Run before committing.

---

## 3. File Naming

| Category | Convention | Example |
|----------|-----------|---------|
| React components | PascalCase | `UserProfile.tsx` |
| Utilities and non-component files | camelCase | `messageTransport.ts` |
| Configuration files | kebab-case | `vite.main.config.ts` |
| Test files | `.test.ts` suffix | `tokenizer.test.ts` |
| Generated files | Never edit manually | `lib/`, `__generated__/`, `.gen.ts` |

---

## 4. Import Conventions

- Prefer **named imports** over default imports
- Group imports in order: external libraries, internal `@scope/` packages, relative imports
- Use workspace protocol for internal packages (e.g., `@sakui/ui-core`, `@kubun/client`)
- Use **`type` keyword** for type-only imports
- **Always import types via module-level `import type`, never via dynamic `import()`** -- dynamic `import()` type annotations defeat tree-shaking, hurt readability, and bypass import organization

```typescript
// Correct
import type { Transport } from '@enkaku/transport'

function connect(transport: Transport) {}

// Incorrect
function connect(transport: import('@enkaku/transport').Transport) {}
```

```typescript
import { describe, expect, test } from 'vitest'

import type { Transport } from '@enkaku/transport'
import { Client } from '@enkaku/client'

import { createHandler } from './handler.js'
import type { HandlerConfig } from './types.js'
```

---

## Repo-Specific

### Event Handling
- Event-based session management patterns
- Tool namespacing: `contextKey:toolName`

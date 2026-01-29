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
- Use `#privateField` for private members (not `private privateField`)
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
}
```

### Naming
- Always use capital `ID` not `Id` (e.g., `threadID`, `spaceID`, `flowID`, `userID`)
- Apply the same pattern for similar abbreviations: `DID` not `Did`, `JWT` not `Jwt`
- Types use PascalCase, variables and functions use camelCase, constants use UPPER_SNAKE_CASE

### General Style
- Target ES2025 with strict mode enabled
- Use `const` assertions where appropriate
- Prefer template literals over string concatenation
- Export types alongside implementation when needed
- Use `type` keyword for type-only imports: `import type { Foo } from './foo.js'`

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

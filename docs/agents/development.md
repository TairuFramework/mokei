# Development

---

## 5. Build System

All repos use **pnpm workspaces** with **Turbo** for build orchestration.

### Package Management
- Use `workspace:^` protocol for internal package dependencies
- Add shared dependency versions to the **pnpm catalog** (defined in `pnpm-workspace.yaml`) when possible
- Each package should be buildable independently
- Avoid circular dependencies between packages

### Compilation
- Use **SWC** for JavaScript compilation (not tsc)
- TypeScript is used only for type checking and declaration generation
- Generated files go in `lib/` directories and should not be edited

### Standard Scripts

Every package should have these scripts where applicable:

| Script | Purpose |
|--------|---------|
| `build` | Full build (types + JS) |
| `build:clean` | Remove build artifacts |
| `build:js` | JavaScript compilation via SWC |
| `build:types` | TypeScript declaration generation |
| `test:types` | Type checking via tsc |
| `test:unit` | Unit tests via Vitest |

Root-level commands:

```bash
pnpm run build        # Build all packages (types then JS)
pnpm run build:types  # TypeScript declarations only
pnpm run build:js     # JavaScript compilation only
pnpm run lint         # Format and lint all packages
```

---

## 6. Testing

All repos use **Vitest** as the test runner.

### Commands
```bash
pnpm test             # Run all tests (type checks + unit tests)
pnpm run test:types   # TypeScript type checking only
pnpm run test:unit    # Unit tests only
```

### Conventions
- Use **`test`** (not `it`) for test cases
- Import from vitest: `import { describe, expect, test } from 'vitest'`
- Use descriptive test names that explain behavior
- Test files use `.test.ts` suffix
- Place tests in `test/` or `__tests__/` directories (follow repo convention)
- Use async/await for asynchronous tests
- Test both success and failure cases

```typescript
import { describe, expect, test } from 'vitest'

describe('TokenValidator', () => {
  test('rejects expired tokens', async () => {
    const token = createToken({ exp: pastDate })
    await expect(validate(token)).rejects.toThrow('Token expired')
  })
})
```

---

## 7. Dependency Stack

Core tools shared across all Yulsi repos:

| Tool | Purpose |
|------|---------|
| **Biome** | Linting and formatting |
| **Vitest** | Testing |
| **pnpm** | Package management (use catalog for shared deps) |
| **Turbo** | Build orchestration |
| **SWC** | JavaScript compilation |
| **TypeScript** | Type checking and declaration generation (strict mode, ES2025) |

---

## 8. Planning and Documentation

All repos use a `docs/plans/` directory for implementation planning.

### Directory Structure

```
docs/plans/              # Active plans (in progress or about to start)
docs/plans/next/         # Immediate priorities (up next)
docs/plans/backlog/      # Low-priority improvements (no timeline)
docs/plans/archive/      # Completed, cancelled, or superseded plans
```

### Workflow

1. **Before implementation**: Write a design or implementation plan in `docs/plans/YYYY-MM-DD-<topic>.md`
2. **During implementation**: Reference the plan, update it if scope changes
3. **After implementation**: Summarize what was built, add a status, and move the plan to `docs/plans/archive/`
4. **Immediate next steps**: Extract high-priority follow-up work into `docs/plans/next/`
5. **Deferred work**: Extract low-priority improvements or ideas into `docs/plans/backlog/`

### Archive Statuses

When moving a plan to `docs/plans/archive/`, add a status at the top of the document:

| Status | Meaning |
|--------|---------|
| **complete** | Fully implemented as planned |
| **partial** | Some items implemented, remaining work moved to next/ or backlog/ |
| **cancelled** | Work was not done, plan is no longer relevant |
| **superseded** | Replaced by a newer plan (link to the replacement) |

Format: Add `**Status:** complete` (or other status) near the top of the archived document.

### Plan Lifecycle

- **`docs/plans/`** -- Active work: plans currently being implemented or about to start
- **`docs/plans/next/`** -- Immediate priorities: concrete work that should be picked up soon
- **`docs/plans/backlog/`** -- Low-priority: potential improvements with no committed timeline
- **`docs/plans/archive/`** -- Done: plans that have been resolved (with a status indicating outcome)

---

## Repo-Specific

### Testing
- Integration tests in `integration-tests/` directory
- Tests in `packages/*/test/`

### Documentation
- `llms.txt` provides LLM-optimized documentation index

### Key Technologies
- Enkaku for streaming/transport (see `enkaku.md`)
- Node.js Streams
- JSON-RPC
- nano-spawn for process management

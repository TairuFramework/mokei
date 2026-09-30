# Host Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@mokei/host-desktop`, a Node-only package whose host `elicit` handler reaches a single desktop user through blocking dialogs or a delayed input inbox, plus optional `local:notify` and `local:ask_user` tools.

**Architecture:** OS tools (`alerter`, `osascript`, `zenity`, `notify-send`) are driven with `execFile` through a tracked runner. Each backend splits into pure `build*Args`/`parse*Result` functions and a thin wrapper. A form module maps flat elicitation schemas to dialogs and validates answers. The handler queues dialogs FIFO under one request budget. In inbox mode it adds entries to an `InputInbox` that an application-registered answer surface settles.

**Tech Stack:** TypeScript, Node `node:child_process` `execFile`, `@sozai/event` `EventEmitter`, vitest, swc/tsc build as in `@mokei/host-node`.

**Spec:** `docs/superpowers/specs/2026-09-29-host-desktop-interaction-design.md`. Task input semantics: the task input lifecycle work merged to `main` (its completed plan summary under `docs/agents/plans/completed/`).

## Global Constraints

- New package `packages/host-desktop`, name `@mokei/host-desktop`, version `0.14.0`, in `versioning.fixed` in `pnpm-workspace.yaml`. The user approved this package on 2026-09-30. Create no other package.
- Runtime dependencies are exactly `@mokei/host`, `@mokei/context-client`, `@mokei/context-protocol` (all `workspace:^`) and `@sozai/event` (`catalog:`). Dev dependencies are `@mokei/host-node`, `@mokei/context-server` (`workspace:^`) and `@types/node` (`catalog:`). No `@mokei/host-node` runtime dependency. No `node-notifier`, no `nano-spawn`.
- Nothing is added to `@mokei/host`, `@mokei/host-node` or `@mokei/session`.
- Child processes use `execFile` only, never a shell. User strings never reach AppleScript source; they go in argv after `--`.
- Kebab-case file names. Error classes take a single params object. Use `pnpm` only.
- Default values: `mode: 'dialog'`, `timeoutSeconds: 90`, `maxTimeoutSeconds: 600`, `appName: 'mokei'`, `describeSource: (r) => r.key ?? 'A server'`, `notificationPromptPreview: false`. Notifications use a 5000 ms timeout. Runner dispose sends `SIGTERM`, then `SIGKILL` after 1000 ms. At most 3 attempts per property and 10 properties per form. `ask_user` choices: 2 to 20. Preview: first 200 characters of `message`.
- Generic notification body: `<describeSource(request)> needs your input`, title `appName`.
- Every failure report goes to `options.onUnsupported(reason)` when given, else `console.error(\`[mokei/host-desktop] ${reason}\`)`. This covers unsupported requests too. That is a ruling: the spec names stderr only for some cases, and one rule is simpler.
- Dialogs never produce `decline` from a close, Escape or dismissal. The supplied adapters never emit `declined`.
- Changeset: `patch` for `@mokei/host-desktop` only. The repo stays on 0.14.x.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013aL7c3bJNMKQSzhweLtJ4y
  ```
- Lint: `rtk proxy pnpm exec biome check packages/host-desktop`. Package tests: `pnpm --filter @mokei/host-desktop test`. The pre-commit hook runs workspace `test:types`; never use `--no-verify`.
- Cross-package tests import built `lib/`. Run `pnpm --filter @mokei/host-desktop... build` after a dependency changes.

### Branch prerequisite

This worktree (`feat/host-desktop`) is based on `main`. Execution is on hold until the task input lifecycle work (`feat/task-input-lifecycle`) is merged to `main`. Before Task 1, rebase onto the updated `main` (`git rebase main`) and confirm that `@mokei/context-client` exports `TaskInputWithdrawnError` and `TaskExpiredError`.

## Review Focus

1. **Dialog answer with unusual text.** A value with quotes, backslashes, newlines, a leading `-` or AppleScript syntax arrives unchanged, and it is never parsed as an option. Tested in Task 2 (argv injection, and `--` before user argv for `osascript`).
2. **A schema `pattern` that is not a valid regular expression.** The request is declined as unsupported; the handler does not throw. Tested in Task 4 (`planForm` returns `ok: false`) and Task 6.
3. **The request signal is already aborted when the handler is called.** The handler rejects at once with the reason, and it opens no dialog and adds no inbox entry. Tested in Task 5 (`add`) and Task 6 (blocking).
4. **A backend binary disappears after detection (`ENOENT`).** The request ends with `cancel` and one report; the handler does not reject. Tested in Task 6.
5. **The user answers through the inbox while `prompt` has a dialog open.** The dialog is killed, and its late result neither settles nor throws. Tested in Task 5.

---

### Task 1: Package scaffold and runner

**Files:**
- Create: `packages/host-desktop/package.json`, `tsconfig.json`, `tsconfig.test.json`, `README.md` (a title and a one-line description; Task 9 writes the rest), `LICENSE` (copy of the repo root `LICENSE`)
- Create: `packages/host-desktop/src/index.ts`, `packages/host-desktop/src/runner.ts`
- Test: `packages/host-desktop/test/runner.test.ts`
- Modify: `pnpm-workspace.yaml` (`versioning.fixed`, alphabetical after `@mokei/host`), `pnpm-lock.yaml` (regenerate with `pnpm install`)

**Interfaces:**
- Produces (`runner.ts`):
  ```ts
  export type RunOptions = { timeoutMs: number; signal?: AbortSignal }
  export type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean }
  export type Runner = {
    run(command: string, args: Array<string>, options: RunOptions): Promise<RunResult>
    dispose(): Promise<void>
  }
  export function createRunner(): Runner
  ```
- Rules:
  - A non-zero exit resolves with `code`; it does not reject.
  - A spawn error (for example `ENOENT`) rejects with that error.
  - On timeout the runner kills the child with `SIGTERM` and resolves with `timedOut: true`.
  - On abort it kills the child and rejects with `signal.reason`. An already-aborted signal rejects without spawning.
  - `dispose()` sends `SIGTERM` to every live child, then `SIGKILL` to any still alive 1000 ms later. After dispose, `run` rejects with `new Error('Runner disposed')`.

- [ ] **Step 1: Scaffold.** Copy the `package.json` fields and scripts from `packages/host-node/package.json`. Change `name`, `description` ("Desktop dialogs, notifications and input inbox for Mokei hosts"), `repository.directory` and the dependencies (Global Constraints). Copy both tsconfigs unchanged. Add the package to `versioning.fixed` and run `pnpm install`.
- [ ] **Step 2: Write the failing tests** in `test/runner.test.ts`. They use real `node -e` children (`process.execPath`):
  - `resolves exit code and output`: `console.log('out'); console.error('err'); process.exit(3)` gives `{ code: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false }`.
  - `kills on timeout`: `setInterval(() => {}, 1000)` with `timeoutMs: 200` resolves `timedOut: true`.
  - `kills on abort`: abort after 100 ms. The promise rejects with the abort reason, and the child's PID is no longer alive (`process.kill(pid, 0)` throws).
  - `already aborted signal does not spawn`.
  - `rejects spawn errors`: the command `definitely-not-a-command-xyz` rejects with `code: 'ENOENT'`.
  - `dispose kills live children and escalates`: the child ignores `SIGTERM` (`process.on('SIGTERM', () => {})`). It is dead within 1500 ms of `dispose()`.
  - `run after dispose rejects` with message `Runner disposed`.
- [ ] **Step 3: Run the tests.** Run `pnpm --filter @mokei/host-desktop test:unit`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement `createRunner()`.** Use `execFile` with a callback and `windowsHide: true`, and track children in a `Set`. Export it from `src/index.ts`.
- [ ] **Step 5: Run and commit.** Run `pnpm --filter @mokei/host-desktop test`; expected PASS. Run the lint. Then commit with `feat(host-desktop): package scaffold and process runner`.

### Task 2: Backend adapters

**Files:**
- Create: `src/backends/types.ts`, `src/backends/alerter.ts`, `src/backends/osascript.ts`, `src/backends/zenity.ts`, `src/backends/notify-send.ts`
- Test: `test/backends.test.ts`

**Interfaces:**
- Consumes: `Runner`, `RunResult` (Task 1).
- Produces (`backends/types.ts`):
  ```ts
  export type AskKind = 'text' | 'confirm' | 'choice'
  export type AskRequest = { kind: AskKind; title: string; text: string; default?: string; choices?: Array<{ value: string; label: string }> }
  export type AskResult = { status: 'answered'; value: string | boolean } | { status: 'declined' } | { status: 'dismissed' } | { status: 'timeout' }
  export type NotifyRequest = { title: string; message: string; subtitle?: string; sound?: boolean }
  export type BackendCallOptions = { timeoutMs: number; signal: AbortSignal }
  export type DesktopBackend = {
    name: BackendName
    ask?: (request: AskRequest, options: BackendCallOptions) => Promise<AskResult>
    notify?: (request: NotifyRequest, options: BackendCallOptions) => Promise<void>
  }
  export type AskBackendName = 'alerter' | 'osascript' | 'zenity'
  export type NotifyBackendName = 'osascript' | 'notify-send'
  export type BackendName = AskBackendName | NotifyBackendName
  ```
  For `confirm`, `default` is `'yes' | 'no'`.
- Each adapter file exports pure functions and a factory:
  - `alerter.ts`: `buildAlerterArgs(request: AskRequest, nativeTimeoutSeconds: number): Array<string>`, `parseAlerterResult(request: AskRequest, result: RunResult): AskResult`, `alerterCanShow(request: AskRequest): boolean` (false when a choice label contains `,`), `createAlerterBackend(runner: Runner): DesktopBackend`.
  - `osascript.ts`: `OSASCRIPT_ASK_SCRIPTS: Record<AskKind, string>`, `OSASCRIPT_NOTIFY_SCRIPT: string`, `buildOsascriptAskArgs(request, nativeTimeoutSeconds): Array<string>`, `parseOsascriptAskResult(request, result): AskResult`, `buildOsascriptNotifyArgs(request: NotifyRequest): Array<string>`, `createOsascriptBackend(runner): DesktopBackend`.
  - `zenity.ts`: `buildZenityArgs(request, nativeTimeoutSeconds)`, `parseZenityResult(request, result)`, `createZenityBackend(runner)`.
  - `notify-send.ts`: `buildNotifySendArgs(request: NotifyRequest, appName: string)`, `createNotifySendBackend(runner, appName: string)`.
- Wrapper rules:
  - `nativeTimeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000) - 5)`.
  - The runner gets `timeoutMs` unchanged, so the native timeout reports first.
  - A runner `timedOut` maps to `{ status: 'timeout' }`.
  - An exit code that the parser does not recognise throws `new Error(<first non-empty stderr line> ?? \`${name} exited with code ${code}\`)`.
  - A `notify` wrapper throws on a non-zero exit or on `timedOut` (message `Notification delivery timed out`).
- Command lines (from the spec, Desktop backends):
  - **alerter:**
    - Base: `--json --timeout N --title T --message X`.
    - `text` adds `--reply <default ?? ''>`; `confirm` adds `--actions Yes,No`; `choice` adds `--actions <labels joined by ','>`.
    - Parse `activationType`: `replied` gives the reply; `actionClicked` gives the value for the clicked label (`Yes`/`No` become `true`/`false`); `closed` and `contentsClicked` give `dismissed`; `timeout` gives `timeout`.
    - alerter is not installed on the dev machine. Build the parser fixtures from alerter v26.5's documented JSON output (its README), and add a README QA item to capture real output. Name this in the report.
  - **osascript:**
    - Args are `-e <line>` for each script line, then `--`, then the user argv.
    - Each script is a fixed constant inside `on run argv … end run`.
    - `text` uses `display dialog … default answer … giving up after N`. `confirm` uses `buttons {"No", "Yes"}`. `choice` uses `choose from list` with no native timeout.
    - Parse: `gave up:true` gives `timeout`; exit 1 with `-128` in stderr gives `dismissed`; `choose from list` printing `false` gives `dismissed`.
    - The notify script uses `display notification`, with `sound name "default"` only when `sound`.
  - **zenity:**
    - `text`: `--entry --title --text --entry-text --timeout`.
    - `confirm`: `--list --radiolist --column Pick --column Choice` with `TRUE|FALSE Yes` and `No` rows. The `default` row is `TRUE`; with no `default`, `Yes`.
    - `choice`: the same list with one row per label. The default row, else the first, is `TRUE`.
    - Exit 0 gives `answered` (for a choice, map the printed label back to its `value`), exit 1 gives `dismissed`, exit 5 gives `timeout`.
  - **notify-send:** `['--app-name', appName, title, message]`.

- [ ] **Step 1: Write the failing table-driven tests**, one `describe` per adapter:
  - Each adapter: args for each kind; each exit code or `activationType` row; a runner `timedOut` gives `timeout`; an unknown exit code throws with the first stderr line.
  - `argv injection` (alerter, osascript, zenity): for text `'"; do shell script "rm -rf ~" --x\n\\'`:
    - the exact string is one element of the args;
    - for osascript it appears only after `--`, and no `-e` script line contains it;
    - `Object.values(OSASCRIPT_ASK_SCRIPTS).join()` contains no user text.
  - `alerterCanShow` is false for a label `'a,b'`.
  - A fake runner records `(command, args, options)` for the wrappers. With `timeoutMs: 30_000`, the native timeout is `25` and the runner gets `30_000`.
- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test:unit test/backends.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four adapters and `types.ts`.
- [ ] **Step 4: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): desktop dialog and notification adapters`.

### Task 3: Detection and install hints

**Files:**
- Create: `src/detect.ts`
- Test: `test/detect.test.ts`

**Interfaces:**
- Consumes: the backend names and factories (Task 2), `Runner`.
- Produces:
  ```ts
  export type DetectOptions = {
    platform: NodeJS.Platform
    env: Record<string, string | undefined>
    isExecutable?: (path: string) => boolean   // default: fs.accessSync(path, X_OK) succeeds
  }
  export type ForcedBackends = { ask?: AskBackendName; notify?: NotifyBackendName }
  export type Availability = { available: ReadonlySet<BackendName>; missing: Partial<Record<BackendName, string>> }
  export function detectAvailability(options: DetectOptions): Availability
  export type BackendSelection = {
    ask?: { name: AskBackendName; forced: boolean }
    notify?: { name: NotifyBackendName; forced: boolean }
    askProblem?: string      // install hint, or the forced-unavailable message
    notifyProblem?: string
  }
  export function selectBackends(availability: Availability, forced: ForcedBackends, platform: NodeJS.Platform): BackendSelection
  export function askBackendFor(request: AskRequest, selection: BackendSelection, availability: Availability):
    { ok: true; name: AskBackendName } | { ok: false; reason: string }
  export function createDetector(options: DetectOptions & { forced?: ForcedBackends }): () => { availability: Availability; selection: BackendSelection }
  ```
  `createDetector` runs detection lazily, once, and caches the result.
- Rules:
  - `PATH` lookup splits `env.PATH` on `:` and checks each `<dir>/<name>` with `isExecutable`.
  - The availability rows come from the spec's Detection table.
  - `missing[name]` records why a backend is unavailable: `'not on PATH'`, `'DISPLAY and WAYLAND_DISPLAY are not set'`, `'DBUS_SESSION_BUS_ADDRESS is not set'`, or `` `not supported on ${platform}` ``.
  - The auto `ask` order is `alerter` then `osascript` on darwin, and `zenity` on linux. The auto `notify` order is `osascript` on darwin and `notify-send` on linux.
  - A forced backend that is unavailable gives a problem that names it: `` `Forced ${capability} backend ${name} is unavailable: ${missing}` ``. The selection is never overridden.
  - Hints are chosen from the failed capability. Tests assert only these substrings:
    - dialog on darwin: `alerter` and `osascript`;
    - dialog on linux: `zenity`, plus `DISPLAY` when the variable was the reason;
    - notify on darwin: `osascript`;
    - notify on linux: `notify-send (libnotify-bin)`, plus `DBUS_SESSION_BUS_ADDRESS` when the variable was the reason.
    - Every hint also mentions the GUI session requirement.
  - `askBackendFor` applies the comma rule for a choice:
    - forced `alerter` gives `{ ok: false }` with a reason containing `alerter cannot show a choice label containing a comma`;
    - auto `alerter` with `osascript` available gives `osascript`;
    - auto `alerter` without `osascript` gives `{ ok: false }` with a reason containing `osascript` (the install hint).

- [ ] **Step 1: Write the failing tests**, one per detection-table row, with injected `platform`, `env` and `isExecutable`:
  - `zenity` without a display; `WAYLAND_DISPLAY=''` counts as unset;
  - `notify-send` without `DBUS_SESSION_BUS_ADDRESS`;
  - win32 has no backends;
  - the forced-unavailable message;
  - the three comma-rule outcomes;
  - `createDetector` calls `isExecutable` only on the first call.
- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test:unit test/detect.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `detect.ts`.**
- [ ] **Step 4: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): backend detection and install hints`.

### Task 4: Form mapping and answer validation

**Files:**
- Create: `src/form.ts`
- Test: `test/form.test.ts`

**Interfaces:**
- Consumes: `AskRequest` (Task 2), `PrimitiveSchemaDefinition` and `ElicitRequest` from `@mokei/context-protocol`.
- Produces:
  ```ts
  export type FormParams = Extract<ElicitRequest['params'], { requestedSchema: unknown }>
  export type RequestedSchema = FormParams['requestedSchema']
  export type FieldPlan = {
    name: string
    required: boolean
    schema: PrimitiveSchemaDefinition
    ask: AskRequest                                  // title = appName; text built per the spec
    toValue(answer: string | boolean): { ok: true; value?: string | number | boolean } | { ok: false; violation: string }
  }
  export type FormPlan = { ok: true; fields: Array<FieldPlan> } | { ok: false; reason: string }
  export function planForm(params: FormParams, options: { appName: string; source: string }): FormPlan
  export function validateContent(schema: RequestedSchema, content: unknown): Array<string>   // issues; empty = valid
  export function withViolation(ask: AskRequest, violation: string): AskRequest                // violation on the text's first line
  ```
- `planForm` rules (spec, Form mapping):
  - Dialog text is `[source, message, title ?? name, description]` without empty entries, joined by `\n`.
  - Each mapping row gives its `kind`, prefill and `choices`. Enum labels come from `enumNames` when present; `oneOf` labels from `title`, else `const`.
  - `toValue` rules:
    - an optional `text` answer of `''` gives `{ ok: true }` with no value;
    - a number or integer uses `Number(answer)`; `''` or `NaN` gives the violation `must be a number`;
    - a constraint failure gives a violation message naming the constraint.
  - `{ ok: false, reason }` for:
    - a property kind not in the table;
    - more than 10 properties;
    - duplicate or empty enum/oneOf values or labels;
    - an `enumNames` length different from the `enum` length;
    - a `pattern` that `new RegExp(pattern, 'u')` rejects (Review Focus 2).
  - Empty `properties` gives `{ ok: true, fields: [] }`. The handler then shows its single confirm.
- Constraint checks, shared by `toValue` and `validateContent`:
  - `minLength`, `maxLength`, `pattern` (`u` flag, tested as a whole-string match with `^(?:…)$`);
  - `minimum`, `maximum`, and `Number.isInteger` for `integer`;
  - `format`:
    - `email` matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`;
    - `uri` passes `URL.canParse`;
    - `date` matches `/^\d{4}-\d{2}-\d{2}$/` and is a valid date;
    - `date-time` is `Date.parse`-able and contains `T`.
- `validateContent` rules (spec, Input inbox, `answer`):
  - The content is an object with only declared keys and every required key.
  - Values have the right types.
  - `enum` and `oneOf` membership holds.
  - A multi-select value is a string array whose every item is in `items.enum` or `items.anyOf[].const`.
  - The constraints above hold.
  - Each issue names its property.

- [ ] **Step 1: Write the failing tests:**
  - each mapping row: kind, prefill, choices and value conversion;
  - the wrapped `{ value }` single-property form;
  - multi-property order follows `Object.keys(properties)`;
  - an optional empty text is omitted;
  - each constraint and each `format` pass and fail;
  - integer `1.5` is rejected;
  - each `ok: false` reason, including `pattern: '('`;
  - `validateContent`: unknown key, missing required key, wrong type, enum miss, a multi-select good array, a multi-select unknown item for both the `items.enum` and `items.anyOf` shapes, and a constraint failure;
  - `withViolation` puts the violation first.
- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test:unit test/form.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `form.ts`.**
- [ ] **Step 4: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): elicitation form mapping and validation`.

### Task 5: Input inbox

**Files:**
- Create: `src/inbox.ts`
- Test: `test/inbox.test.ts`

**Interfaces:**
- Consumes: `validateContent`, `FormParams` (Task 4); `TaskInputWithdrawnError` from `@mokei/context-client`; `EventEmitter` from `@sozai/event` (`fire(name, payload)`, `on(name, listener)` returning an unsubscribe function).
- Produces: `createInputInbox`, `InputInbox`, `InboxPrompt`, `PendingInput`, `InputInboxEvents`, exactly as in the spec's Input inbox block. Also:
  ```ts
  export type DesktopElicitRequest = { key?: string; params: ElicitRequest['params']; signal: AbortSignal }
  export class InboxDisposedError extends Error { constructor(params?: { cause?: unknown }) }                 // message 'Input inbox disposed'
  export class InboxAnswerInvalidError extends Error {
    constructor(params: { id: string; issues: Array<string> })   // message `Invalid answer for input ${id}: ${issues.join('; ')}`
    get id(): string
    get issues(): Array<string>
  }
  ```
  `DesktopElicitRequest` lives in `inbox.ts` so that the handler (Task 6) imports it from here.
- Rules. Everything not listed here follows the spec, Input inbox:
  - `add`:
    - URL mode throws `TypeError('Input inbox accepts form-mode requests only')`.
    - An already-aborted signal rejects at once with its reason: no entry and no `added` (Review Focus 3).
    - `canPrompt` is `options.prompt != null`.
  - Settle order: delete the entry, abort any open prompt, fire `settled` (action only), then resolve the `add` promise.
  - Remove order (abort or dispose): delete the entry, abort any open prompt, fire `removed`, then reject.
  - `removed.reason`:
    - `'withdrawn'` when `signal.reason instanceof TaskInputWithdrawnError`;
    - `'aborted'` for any other abort, `TaskExpiredError` included;
    - `'disposed'` on `dispose()`.
  - `prompt(id)`:
    - calls the entry's `InboxPrompt` with a per-entry `AbortController` signal;
    - its result settles the entry with that action, and `content` too on `accept`;
    - a result arriving after settlement is ignored (Review Focus 5);
    - a rejection leaves the entry pending, and `prompt` rejects with it;
    - a missing entry rejects `new Error(\`No pending input ${id}\`)`; a missing prompt rejects `new Error(\`Input ${id} cannot be prompted\`)`.
  - `registerAnswerSurface()` returns an idempotent unregister function. When the count drops to 0 with entries pending, the inbox logs `[mokei/host-desktop] Last input answer surface closed; cancelling N pending inputs` with `console.error`, then settles each entry as `cancel`.
  - `dispose()` is idempotent. A later `add` rejects with `InboxDisposedError`.

- [ ] **Step 1: Write the failing tests** (spec, Testing, Inbox). Also:
  - `add` with an aborted signal adds nothing;
  - the `settled` payload has no `content` key;
  - event order `added`, then `settled`/`removed`, observed before the `add` promise settles;
  - an external `answer` while a prompt is open aborts the prompt signal; the prompt's late `accept` is ignored and nothing throws;
  - a prompt rejection keeps the entry;
  - a double unregister counts once;
  - a `TaskInputWithdrawnError({ taskID: 't', key: 'k' })` abort gives `'withdrawn'`; `new Error('x')` gives `'aborted'`.
- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test:unit test/inbox.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `inbox.ts`** and export it from `index.ts`.
- [ ] **Step 4: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): pending input inbox`.

### Task 6: Blocking desktop elicit handler

**Files:**
- Create: `src/elicit-handler.ts`, `src/report.ts` (`report(onUnsupported: ((reason: string) => void) | undefined, reason: string): void`, following the Global Constraints rule)
- Test: `test/elicit-handler.test.ts`, `test/elicit-handler.test-d.ts` (type test run by `test:types`)

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces:
  ```ts
  export type DesktopElicitOptions = {
    mode?: 'dialog' | 'inbox'
    inbox?: InputInbox
    timeoutSeconds?: number
    maxTimeoutSeconds?: number
    appName?: string
    describeSource?: (request: DesktopElicitRequest) => string
    notificationPromptPreview?: boolean
    backends?: ForcedBackends
    runner?: Runner
    platform?: NodeJS.Platform
    env?: Record<string, string | undefined>
    onUnsupported?: (reason: string) => void
    /** Test seam: replaces adapter construction. */
    createBackend?: (name: BackendName, runner: Runner) => DesktopBackend
  }
  export type DesktopElicitHandler = ((request: DesktopElicitRequest) => Promise<ElicitResult>) & { dispose(): Promise<void> }
  export function createDesktopElicitHandler(options?: DesktopElicitOptions): DesktopElicitHandler
  ```
- Rules (spec, Blocking mode, Result mapping, Declined without a dialog):
  - **Budget:**
    - `budgetMs = Math.min(timeoutSeconds, maxTimeoutSeconds) * 1000`, starting at invocation.
    - Each backend call gets `timeoutMs = remaining`.
    - When the budget expires, a queued request leaves the queue and an open dialog is killed. Either way the result is `{ action: 'cancel' }`.
  - **Queue:** FIFO, one open dialog per handler. A request whose signal aborts while queued leaves the queue and rejects with the reason.
  - **Abort:** an abort while a dialog is open kills it and rejects with `signal.reason`. An already-aborted signal rejects before queueing.
  - **Decline without a dialog:** return `decline` and `report(...)` for: URL mode; `planForm` `ok: false`; no `ask` backend (report `askProblem`); `askBackendFor` `ok: false`. These never throw.
  - **Per property:**
    - `answered` goes through `toValue`. A violation re-asks with `withViolation`, up to 3 attempts, then gives `cancel`.
    - `dismissed` or `timeout` gives `cancel`. `declined` gives `decline`.
  - **Empty `properties`:** one `confirm` with the message. `true` gives `{ action: 'accept', content: {} }`; anything else gives `cancel`.
  - **Backend failure:** a backend throw that is not an abort (an unknown exit code, or `ENOENT`) gives `cancel` and `report(error.message)` (Review Focus 4).
  - **Dispose:** disposes an owned runner, which kills dialogs. Queued requests reject with `new Error('Desktop elicit handler disposed')`, and so do later calls.
  - `mode: 'inbox'` without `inbox` throws `TypeError('mode "inbox" requires an inbox')` at construction. In this task, inbox mode may throw `not implemented`; Task 7 fills it in.

- [ ] **Step 1: Write the failing tests.** Use vitest fake timers and a fake backend through `createBackend`; the fake records calls and resolves on command. Cover:
  - each result-mapping row;
  - FIFO: the second request's dialog opens only after the first settles;
  - budget expiry while queued, across two fields, and across violation retries, all giving `cancel` at 90 s;
  - `maxTimeoutSeconds` clamping;
  - abort while queued and abort while open (the fake's signal is aborted);
  - an already-aborted signal;
  - `dispose()` while open and queued;
  - each decline reason calls `onUnsupported`;
  - no `onUnsupported`: `console.error` is spied with the `[mokei/host-desktop]` prefix;
  - a backend throwing an `ENOENT` error gives `cancel`.
- [ ] **Step 2: Write the type test.** In `elicit-handler.test-d.ts`, `const h = createDesktopElicitHandler()` is assignable to `HostElicitHandler` (`@mokei/host`) and to `ElicitHandler` (`@mokei/context-client`). The file must be included by `tsconfig.test.json` (it already includes `./test/**/*`).
- [ ] **Step 3: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test`. Expected: FAIL.
- [ ] **Step 4: Implement** `elicit-handler.ts` and `report.ts`, and export them from `index.ts`.
- [ ] **Step 5: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): blocking desktop elicit handler`.

### Task 7: Inbox mode

**Files:**
- Modify: `src/elicit-handler.ts`
- Test: `test/elicit-handler-inbox.test.ts`

**Interfaces:**
- Consumes: `InputInbox.add/hasAnswerSurface` (Task 5) and the blocking path (Task 6).
- Rules (spec, Inbox mode):
  - A URL-mode request gives `decline` and a report.
  - With no answer surface, report `No input answer surface is registered; cancelling input from <source>` and return `cancel` without adding an entry.
  - Otherwise `inbox.add(request, { prompt })`, where `prompt` is set only when `planForm` is `ok: true`. `prompt(signal)` runs the blocking path for this request. Its signal combines the prompt signal with `request.signal`, and it gets a fresh budget from `prompt` invocation.
  - After `add`, the handler starts a notification without awaiting it:
    - title `appName`, body `<source> needs your input`;
    - with `notificationPromptPreview`, add `: ` and the first 200 characters of `message`;
    - `timeoutMs: 5000`.
  - A missing notify backend (`notifyProblem`), a throw or a timeout is reported, and the entry stays.
  - The handler returns the `add` promise.

- [ ] **Step 1: Write the failing tests** (spec, Testing, Inbox-mode handler). Also:
  - `added` fires before the notify call starts;
  - a forced unavailable `notify` backend is reported;
  - the pending entry is still answerable after 91 s under fake timers;
  - a `prompt(id)` at 100 s gets its own 90 s budget, giving `cancel` at 190 s;
  - a fake waiter abort with `TaskInputWithdrawnError` removes the entry with `'withdrawn'`;
  - in blocking mode, the same abort kills the open dialog (Task input contract row).
- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test:unit test/elicit-handler-inbox.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement inbox mode.**
- [ ] **Step 4: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): inbox mode for the desktop elicit handler`.

### Task 8: Local tools

**Files:**
- Create: `src/tools.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `LocalToolDefinition` (`@mokei/host`), `DesktopElicitRequest`, detection and backends.
- Produces:
  ```ts
  export type DesktopToolsOptions = {
    elicit?: (request: DesktopElicitRequest) => Promise<ElicitResult>
    notify?: boolean                                  // default true
    timeoutSeconds?: number                           // default 90
    appName?: string
    backends?: ForcedBackends
    runner?: Runner
    platform?: NodeJS.Platform
    env?: Record<string, string | undefined>
    createBackend?: (name: BackendName, runner: Runner) => DesktopBackend
  }
  export function createDesktopTools(options: DesktopToolsOptions): Array<LocalToolDefinition>
  ```
  The tools are named `notify` and `ask_user`. The spec, Local tools, defines their input schemas, validation (`isError: true` naming the field), results (`structuredContent` plus the same JSON as text) and timeout and cancel rules.
- `ask_user`:
  - Its description includes `A timeout returns status "cancelled".`
  - It calls `elicit({ key: 'local', params: { mode: 'form', message: question, requestedSchema: { type: 'object', properties: { answer }, required: ['answer'] } }, signal })`.
  - `answer` is `{ type: 'string' }`, `{ type: 'boolean' }` or `{ type: 'string', enum: choices }`, carrying `default`. A `confirm` default of `'yes'`/`'no'` becomes `true`/`false`.
  - A rejection caused by its own `AbortSignal.timeout` gives `{ status: 'cancelled' }`. Any other rejection rethrows.
- `notify` has no timeout of its own beyond 5000 ms. On success it returns `{ delivered: true, backend }`. A missing backend gives `isError` with the notify hint.

- [ ] **Step 1: Write the failing tests.** Call the tools through `new ContextHost()`, `addLocalTools`, then `callLocalTool` (import `ContextHost` from `@mokei/host`). Cover:
  - `notify` success, a missing backend, and the delivery timeout (fake timers);
  - `notify: false` omits the tool; no `elicit` omits `ask_user`;
  - `ask_user` validation per field: `choices` count and uniqueness, `default` not in `choices`, `confirm` default not `yes`/`no`;
  - each status, and the elicit request shape;
  - its own timeout gives `cancelled`;
  - an external cancel gives `isError` from `callLocalTool`.
- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @mokei/host-desktop test:unit test/tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `tools.ts`** and export it from `index.ts`.
- [ ] **Step 4: Run, lint and commit.** Run the tests (PASS) and the lint. Commit with `feat(host-desktop): notify and ask_user local tools`.

### Task 9: Task integration, Linux end-to-end, docs and release

**Files:**
- Test: `test/task-inbox.test.ts`, `test/zenity-e2e.test.ts`
- Modify: `.github/workflows/build-test.yml`, `docs/agents/architecture.md`, `packages/host-desktop/README.md`
- Create: `.changeset/host-desktop.md`

**Interfaces:**
- Consumes: the whole public API; `ContextServer`, `createTaskManager`, `createTool` from `@mokei/context-server`; `ContextHost.addDirectContext` from `@mokei/host`.

- [ ] **Step 1: Write the task integration tests.** Build dependencies first with `pnpm --filter @mokei/host-desktop... build`.
  - Setup: one `ContextServer` (`protocolVersions: ['2026-07-28']`, `subscriptions: true`, `tasks: createTaskManager(...)`), shaped like `packages/context-client/test/tasks-client.test.ts:115-140`. Its tool's `task.run` work calls `handle.requestInput({ value: { method: 'elicitation/create', params } }, { signal })`, where `signal` is a test-controlled deadline. The host is `new ContextHost({ elicit: handler })`, with an inbox-mode handler, a fake backend and a registered surface, plus `addDirectContext`.
  - Cases: the spec's Testing bullet "Decision-flow-style task through the inbox", one test each:
    - answer completes the task with the value;
    - decline and cancel reach the work function;
    - a deadline gives `'withdrawn'`;
    - the last `tasks.wait` abort removes the entry, and the task stays `input_required`;
    - a second `tasks.wait` re-adds the entry;
    - a TTL expiry with no status event removes the entry after the wait fails with `TaskExpiredError`. Use a short `ttlMs`; `pollIntervalMs` can stay large, because the subscribed wait checks the TTL.
- [ ] **Step 2: Write the Linux end-to-end test.** In `test/zenity-e2e.test.ts`, `describe.runIf(process.env.DESKTOP_E2E)`: real `createZenityBackend(createRunner())` for each kind with `timeoutMs: 6_000` (native 1 s) returns `{ status: 'timeout' }`.
- [ ] **Step 3: Run.** Run `pnpm --filter @mokei/host-desktop test`. Expected: PASS, with the e2e skipped.
- [ ] **Step 4: Add the CI step.** In `.github/workflows/build-test.yml`, after `Test`, add:
  ```yaml
  - name: Desktop dialogs (Linux)
    run: |
      sudo apt-get update
      sudo apt-get install -y zenity xvfb
      xvfb-run -a env DESKTOP_E2E=1 pnpm --filter @mokei/host-desktop run test:unit
  ```
- [ ] **Step 5: Write the docs.**
  - `README.md`: every topic listed in the spec's Release and docs section, including the durability limitation for `AgentSession`-started flows, `dispose` wiring to `SIGTERM`/`SIGINT`, and the macOS QA checklist (with "capture real alerter JSON output and check the parser fixtures").
  - `architecture.md`:
    - a Feature Map row (`Desktop elicitation and input inbox | @mokei/host-desktop | createDesktopElicitHandler, createInputInbox, createDesktopTools`);
    - a Package Structure line `host-desktop/         # Desktop dialogs, notifications and input inbox (Node-only)`;
    - a Node-only paragraph sentence;
    - one Session Elicitation paragraph;
    - the MCP Tasks line from the spec, only for what the lifecycle branch's architecture paragraph does not already say.
- [ ] **Step 6: Write the changeset.** In `.changeset/host-desktop.md`, frontmatter `'@mokei/host-desktop': patch`, with one paragraph describing the package.
- [ ] **Step 7: Verify.** Run `pnpm --filter @mokei/host-desktop test`, the lint, `rtk proxy pnpm run lint`, and the workspace `pnpm run test:types` (through turbo, as the hook does). Expected: all green.
- [ ] **Step 8: Commit** with `feat(host-desktop): task integration tests, Linux e2e, docs and changeset`.

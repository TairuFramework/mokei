# Host desktop follow-ons

**Status:** open · follow-on of [host desktop interaction](../completed/2026-09-30-host-desktop.complete.md)
**Package:** `@mokei/host-desktop`

## Items

- **Unverified backend behaviour.** zenity escaping follows the zenity 4 source only (3.x not
  checked). alerter JSON field names and argv parsing come from its docs; confirm on a Mac with
  alerter installed (Manual QA below). The first CI run is the first real zenity run.
- **Manual QA.** Linux dialogs run end to end in CI (`zenity` under `xvfb`, answered with
  `xdotool`, and left to time out). macOS is covered by unit tests plus this manual checklist,
  run through a `NodeContextHost`. Moved from the package README.
  - macOS alerter:
    - [ ] On macOS with `alerter` v26.5 installed, capture the real `--json` output for a reply, an action click, a close, a content click and a timeout, and confirm the `activationType` and `activationValue` fields the parser reads in `src/backends/alerter.ts` (the parser fixtures were written from documentation, not captured output). Update the parser fixtures in `test/backends.test.ts` to match the captured output.
    - [ ] With `alerter` installed and with it absent (`osascript` fallback), show each dialog kind (text, confirm, choice) and check the answer.
  - macOS osascript:
    - [ ] Values starting with `-` never reach alerter (they fall back to `osascript`, or decline when `alerter` is forced). Check that a choice with a `-timeout` label and a text field with a `--appIcon` default open an `osascript` dialog with the text unchanged.
    - The `alerter`-absent half of the dialog-kind step above covers the `osascript` fallback.
  - macOS, either dialog backend:
    - [ ] Let a dialog time out and check the result is `cancel`.
    - [ ] Abort a request while its dialog is open and check the dialog closes.
  - Linux zenity: covered by the CI end-to-end run described above; no manual steps.
  - Linux notify-send: the checklist had no steps for it, and CI does not show a real
    notification.
  - Inbox mode:
    - [ ] In inbox mode, check the notification appears, then answer an entry with `inbox.prompt(id)`.

## Done in the flow references, decline and validators PR

- **AJV scope growth.** `form.ts` compiles on an isolated validator factory, recycled after 256 distinct compiles, with the 64-entry LRU cleared alongside and keyed by canonical JSON. The shared process-wide AJV instance no longer grows with each distinct server schema.

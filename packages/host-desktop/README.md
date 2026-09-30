# @mokei/host-desktop

Desktop dialogs, notifications and input inbox for Mokei hosts.

## QA checklist

- [ ] On macOS with `alerter` v26.5 installed, capture the real `--json` output for a reply, an action click, a close, a content click and a timeout, and confirm the `activationType` and `activationValue` fields the parser reads in `src/backends/alerter.ts` (the parser fixtures were written from documentation, not captured output).

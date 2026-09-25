# Verify and release the React Native-safe host split

**Status:** release complete; Metro acceptance gate unrecorded
**Origin:** `next/2026-08-25-host-rn-verify-and-release.md`, removed by `66160bd` without a
completion record. The original next item required a real Sakui Metro export and a major release.

## Outcome

- The split described in `completed/2026-08-25-host-rn-bundler-safe-entry.complete.md` was
  released: `packages/host/package.json` is at `0.13.1`, and the Sakui workspace catalog pins
  `@mokei/host` and `@mokei/host-node` at `^0.13.1`. Sakui's `packages/runtime` consumes
  `@mokei/host`, which its mobile app consumes through the runtime workspace package.
- The deleted next plan required `pnpm exec expo export --platform ios --output-dir dist` from
  `sakui/apps/mobile`. No result for that Metro/Hermes acceptance command is recorded in this
  repository. Downstream consumption is evidence of integration, not a recorded export pass.
- The original plan called this a major release, but the observed published line is `0.13.x`.
  This summary records the released version without claiming the planned version bump occurred.

## Evidence

`git show 66160bd^:docs/agents/plans/next/2026-08-25-host-rn-verify-and-release.md` preserves
the removed checklist. The host split landed in `28c0ff6`; package versions and the Sakui
`pnpm-workspace.yaml` catalog establish the released downstream line.

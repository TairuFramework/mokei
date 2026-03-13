# Dev Loop

Orchestrate the full development cycle with session resumption.

## On Invocation

Before starting anything new, detect in-progress work:

1. Check `docs/superpowers/plans/` for plan files. If found, read the `**Stage:**` field to determine current stage.
2. Check `docs/superpowers/specs/` for spec files without a corresponding plan in `docs/superpowers/plans/`. If found, brainstorming is in progress (no Stage field exists yet).
3. Check git branch. If on a feature branch with commits ahead of main, work is in flight.
4. Check `docs/agents/plans/next/` for prioritised work.

Based on findings, present:
- **"Continue X"** -- resume detected in-progress work at the right stage
- **"Start new"** -- nothing in flight, pick from `next/`, `backlog/`, or a fresh idea

## Starting from next/ or backlog/

When the user picks a `next/` or `backlog/` item: the item serves as input context for brainstorming, not as a plan itself. Delete the original file from `next/`/`backlog/` once brainstorming produces a spec. If the user abandons the idea during brainstorming, leave the original item in place.

## Stages

Guide through stages in order, invoking the appropriate skill at each:

| Stage | Skill | State signal |
|-------|-------|--------------|
| brainstorming | `superpowers:brainstorming` | Spec exists in `docs/superpowers/specs/`, no plan |
| planning | `superpowers:writing-plans` | `**Stage:** planning` in plan file |
| executing | `superpowers:executing-plans` | `**Stage:** executing` |
| reviewing | `superpowers:requesting-code-review` | `**Stage:** reviewing` |
| qa | (prompt user to test) | `**Stage:** qa` |
| completing | `/complete` | `**Stage:** completing` |
| finishing | `superpowers:finishing-a-development-branch` | `**Stage:** finishing` |

Stages are not atomic -- `executing` and `reviewing` can span multiple sessions. Update `**Stage:**` in the plan file when a stage completes (not during), then commit.

## Stage Details

### brainstorming
Invoke `superpowers:brainstorming`. Once a spec is produced in `docs/superpowers/specs/`, this stage is complete.

### planning
Invoke `superpowers:writing-plans`. The plan file is created in `docs/superpowers/plans/` with `**Stage:** planning`. Once the plan is written and approved, update Stage to `executing` and commit.

### executing
Invoke `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if subagents are available). Work through the plan tasks. Once all tasks are checked, update Stage to `reviewing` and commit.

### reviewing
Invoke `superpowers:requesting-code-review`. Address feedback. Once review passes, update Stage to `qa` and commit.

### qa
Prompt the user to test. Provide test guidance from the plan if available. Wait for user confirmation that QA passes. Once confirmed, update Stage to `completing` and commit.

### completing
Invoke `/complete` skill. This summarises the finished plan, writes to `docs/agents/plans/completed/`, and cleans up ephemeral files. Once complete, update Stage to `finishing` and commit.

### finishing
Invoke `superpowers:finishing-a-development-branch`. This handles merge/PR/cleanup.

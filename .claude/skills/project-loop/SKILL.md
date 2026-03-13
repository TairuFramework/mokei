# Project Loop

Orchestrate project-level management: priorities, roadmap, architecture review, and triage. Higher-level peer to dev-loop — manages the portfolio of work rather than individual feature implementation. Can delegate to dev-loop when conversation narrows to a specific feature.

## Path Context

All paths assume this skill is running inside a consuming repo (sakui, enkaku, kubun, mokei). The agents repo contains no plans hierarchy or architecture docs — project-loop is propagated from agents but only operates in consuming repos.

## Branch Expectations

Project-loop operates on the main branch. Write operations (triage, roadmap, state file) modify persistent artifacts on main. If invoked on a feature branch, suggest switching to main before write operations. Read-only operations (session start summary) can run on any branch.

## On Invocation

### 1. Session Start (always runs first)

Check project state and present a concise summary:

1. Check for in-flight dev work (`docs/superpowers/specs/`, `docs/superpowers/plans/`). If found, suggest `/dev-loop` instead, but don't force it.
2. Read `docs/agents/plans/project-loop-state.md` for last activity timestamps. If it doesn't exist, note this (first run).
3. Scan `docs/agents/plans/next/`, `docs/agents/plans/backlog/`, `docs/agents/plans/completed/`, `docs/agents/plans/roadmap.md`, `docs/agents/plans/milestones/`.
4. Present summary as a few bullet points (not a wall of text).

Based on findings, suggest relevant modes:

- **Triage** — if backlog/next has items whose filename date prefix is more than 4 weeks old and have not been reviewed since the last triage timestamp in the state file
- **Review** — if last review was more than 2 weeks ago per the state file, or if no review has ever been recorded
- **Roadmap** — if no `roadmap.md` exists, or roadmap file is stale, or significant work has been completed since last roadmap update

The user picks a mode, skips to `/dev-loop`, or states what they want. Modes are suggestions, not gates — the user can always override.

### 2. Run Selected Mode

Execute the mode the user chose. After any mode completes, suggest the next natural action — including handing off to `/dev-loop` if a concrete feature was identified.

## Modes

### Triage

1. Read all files in `docs/agents/plans/next/` and `docs/agents/plans/backlog/`
2. For each item, assess: still relevant? priority changed? blocked by something? ready to build?
3. Propose concrete actions per item:
   - Promote from backlog/ to next/
   - Demote from next/ to backlog/
   - Remove (no longer relevant)
   - Rewrite (outdated description)
   - Merge (duplicates another item)
4. Wait for user approval on each action
5. Execute approved actions (file moves, edits, deletes)
6. Update `docs/agents/plans/project-loop-state.md` with triage timestamp
7. Commit with message: `docs: triage plans`

### Review

Three sub-checks, presented together as a findings list:

**Architecture:**
- Read `docs/agents/architecture.md` and `AGENTS.md`
- Compare against actual project structure (package dirs, key files, exports)
- Flag mismatches (missing packages, renamed dirs, outdated diagrams)

**Conventions:**
- Spot-check a sample of code files against `docs/agents/conventions.md` rules
- Not exhaustive — sample-based to catch drift

**Completed follow-ups:**
- Read recent items in `docs/agents/plans/completed/`
- Check if extracted follow-on work in next/backlog was actually picked up

Present all findings as a list with recommended actions. For each finding:
- Mechanical fixes (doc updates reflecting actual structure): draft the change
- Strategic questions (should we restructure? is this pattern still right?): surface the question for user decision

User decides what to fix now, add to backlog, or ignore. Execute approved fixes.

After executing:
1. Update `docs/agents/plans/project-loop-state.md` with review timestamp
2. Commit with message: `docs: review architecture and conventions`

### Roadmap

**If no roadmap exists (`docs/agents/plans/roadmap.md` not found):**
1. Read next/, backlog/, recent completed/ and archive/ summaries, and architecture.md
2. Synthesize into a draft roadmap: high-level goals, current priorities, rough sequencing
3. Present draft for user review
4. Write approved version to `docs/agents/plans/roadmap.md`

**If roadmap exists:**
1. Read current roadmap and any milestone docs it references (`docs/agents/plans/milestones/`)
2. Read next/, backlog/, recent completed/ and archive/ summaries
3. Compare roadmap against current state
4. Flag: completed goals, new gaps, stale items, priority shifts
5. Draft updates for user approval
6. Write approved changes

After writing:
1. Update `docs/agents/plans/project-loop-state.md` with roadmap timestamp
2. Commit with message: `docs: create project roadmap` or `docs: update project roadmap`

Keep the roadmap concise — goals and sequencing, not detailed specs.

## State File

`docs/agents/plans/project-loop-state.md` tracks when each activity was last performed. Repo-local (not propagated from agents repo). Created on first write.

Format:

```
# Project Loop State

| Activity | Last performed |
|----------|---------------|
| Triage | YYYY-MM-DD |
| Review | YYYY-MM-DD |
| Roadmap | YYYY-MM-DD |
```

## Artifacts

### Owned (read-write)

| Artifact | Purpose |
|----------|---------|
| `docs/agents/plans/roadmap.md` | Project roadmap — repo-local |
| `docs/agents/plans/project-loop-state.md` | Activity timestamps — repo-local |

### Read-only

| Artifact | Purpose |
|----------|---------|
| `docs/agents/plans/next/` | Immediate priorities |
| `docs/agents/plans/backlog/` | Future work |
| `docs/agents/plans/completed/` | Recent completions |
| `docs/agents/plans/archive/` | Historical summaries |
| `docs/agents/plans/milestones/` | Detailed design docs for current focus areas |
| `docs/superpowers/specs/` | In-flight design specs |
| `docs/superpowers/plans/` | In-flight implementation plans |
| `docs/agents/architecture.md` | Architecture documentation |
| `AGENTS.md` | Project agent instructions |
| `docs/agents/conventions.md` | Code conventions |
| `docs/agents/development.md` | Development practices |

## Integration

Project-loop and dev-loop are peers. Either can be invoked directly:
- `/project-loop` — big-picture management, can delegate down to dev-loop
- `/dev-loop` — feature implementation, invoked when you know what to build or have work in progress

Any time the conversation narrows to "let's build X", suggest invoking `/dev-loop`. If triage or roadmap surfaces a concrete next item and the user wants to start it, same hand-off. Project-loop may suggest dev-loop; dev-loop never invokes project-loop.

## Boundaries

Project-loop does NOT:
- Execute implementation work (that's dev-loop)
- Own the spec/plan lifecycle (that's brainstorming/writing-plans/complete/archive)
- Make priority decisions autonomously — always presents and waits for approval
- Perform cross-repo analysis (future improvement)

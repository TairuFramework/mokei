# Complete Plan

Summarise finished work and transition from ephemeral to persistent storage.

All writes happen on the feature branch. The persistent files in `docs/agents/plans/` land on `main` when the branch merges via the finishing stage.

## Process

1. **Find the plan and spec.** Read the plan from `docs/superpowers/plans/` and spec from `docs/superpowers/specs/`. If multiple files exist, ask the user which to complete.

2. **Verify completion.** Check that all plan tasks are checked and tests are passing.

3. **Handle incomplete work.** If not complete, ask the user: proceed as `partial` (extract remaining work to `next/`/`backlog/`), or return to executing stage.

4. **Summarise.** Create a summary of the completed work:
   - **Keep:** goal, key design decisions (from spec), architecture choices, what was built, status
   - **Strip:** code samples, task checklists, implementation details
   - **Calibrate detail:** one-liner for straightforward work, short paragraph for significant changes
   - The summary deliberately preserves key design decisions from the spec so that the rationale for architectural choices survives beyond the ephemeral files.

5. **Determine status.** One of:
   - `complete` -- fully implemented as planned
   - `partial` -- some items implemented, remaining work extracted
   - `superseded` -- replaced by a different approach
   - `cancelled` -- work was not done, plan is no longer relevant

6. **Write the completed summary.** Save to `docs/agents/plans/completed/YYYY-MM-DD-feature-name.<status>.md` using the date from today and the feature name from the plan filename.

7. **Extract follow-on work.** If there is remaining or follow-on work:
   - High-priority items go to `docs/agents/plans/next/`
   - Low-priority items go to `docs/agents/plans/backlog/`

8. **Clean up ephemeral files.** Delete the plan from `docs/superpowers/plans/` and the spec from `docs/superpowers/specs/`.

9. **Commit.** Stage all changes and commit with message: `docs: complete plan for <feature>`

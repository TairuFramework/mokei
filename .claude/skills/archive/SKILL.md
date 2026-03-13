# Archive Completed Plans

Consolidate unreferenced completed plans into monthly summaries. Invoke manually for housekeeping.

## Process

1. **Scan completed plans.** List all files in `docs/agents/plans/completed/`.

2. **Scan for cross-references.** Check `docs/agents/plans/next/` and `docs/agents/plans/backlog/` for references to completed plans. A cross-reference is any markdown link (`[text](path)`) or file path string that resolves to a completed plan's filename.

3. **Scan active work.** Check `docs/superpowers/plans/` and `docs/superpowers/specs/` for any active work referencing completed plans.

4. **Present findings to the user:**
   - **Safe to archive:** completed plans with no references from active/next/backlog
   - **Still referenced:** completed plans still providing context (show what references them)

5. **User selects which to archive** (or accepts the suggestion).

6. **Group by month.** Use the date prefix in the completed plan's filename (e.g., `2026-01-28-feature.complete.md` goes into January 2026).

7. **Generate monthly summaries.** For each month being archived:
   - Generate or update `docs/agents/plans/archive/YYYY-MM-archive-summary.md`
   - Calibrate per-entry detail: one-liner for simple plans, short paragraph for significant work
   - If a monthly summary already exists, merge new entries into it
   - Use this format for the monthly summary:

     ```markdown
     # YYYY-MM Archive Summary

     ## Plans Completed

     - **feature-name** (YYYY-MM-DD, status) -- one-liner or short paragraph
     - **feature-name** (YYYY-MM-DD, status) -- one-liner or short paragraph
     ```

8. **Delete individual completed plan files** that were archived.

9. **Fix stale cross-references.** Update any references in `docs/agents/plans/backlog/` and `docs/agents/plans/next/` that pointed to now-deleted completed plans -- update to point at the monthly summary file or remove the reference.

10. **Commit.** Stage all changes and commit with message: `docs: archive completed plans for <month(s)>`

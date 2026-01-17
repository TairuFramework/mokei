# Documentation Reorganization Design

**Date**: January 17, 2025
**Status**: Approved

## Goals

1. **Consistency** - Unified documentation structure
2. **Progressive discovery for LLMs** - AI assistants can find relevant docs quickly
3. **Layered entry points** - Different readers (AI assistants, human developers) get appropriate starting points

## File Structure

```
mokei/
├── AGENTS.md                    # Entry point for AI assistants
├── README.md                    # Entry point for humans
├── docs/
│   ├── index.md                 # Documentation overview
│   ├── guides/
│   │   ├── quick-start.md       # Getting started
│   │   ├── server.md            # Creating MCP servers
│   │   ├── client.md            # Creating MCP clients
│   │   ├── host.md              # Managing connections
│   │   ├── session.md           # Chat sessions
│   │   ├── agent.md             # Agent sessions
│   │   ├── providers.md         # Model providers
│   │   └── cli.md               # CLI usage
│   └── plans/
│       └── roadmap.md           # Project roadmap (merged PRD + implementation plan)
└── llms.txt                     # Index for LLM documentation discovery
```

## Entry Point Purposes

### AGENTS.md (for AI assistants)
- Project overview and architecture summary
- Development commands (build, test, lint)
- Code style rules (type vs interface, Array<T> vs T[])
- File discovery hints
- Links to docs/ for deeper dives

### README.md (for humans)
- Project description and badges
- Installation instructions
- Quick usage example
- Links to full documentation
- Contributing/license info

### docs/index.md (shared reference)
- Package overview table
- Architecture diagram
- Links to all guides

## Migration Plan

### Files to create
- `AGENTS.md` - adapted from CLAUDE.md
- `docs/index.md` - documentation hub
- `docs/guides/quick-start.md` - getting started guide
- `docs/plans/roadmap.md` - merged PRD + implementation plan

### Files to move
- `llms/*.md` → `docs/guides/*.md`

### Files to update
- `README.md` - add links to new docs structure
- `llms.txt` - update to point to new locations

### Files to delete
- `CLAUDE.md`
- `PRD.md`
- `IMPLEMENTATION_PLAN.md`
- `llms/` folder

## Merged Roadmap Structure

The combined `docs/plans/roadmap.md` consolidates:
- Project vision and positioning (from PRD)
- Competitive analysis (from PRD)
- Completed work with learnings (from implementation plan)
- Planned features (from both)
- Design decisions rationale

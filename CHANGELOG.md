# Changelog

All notable changes to relay-patch are documented here.

## [0.1.0] - 2026-06-18

### Added

- `init` — set up `.relay-patch` repo and upstream config
- `draft "<intent>"` — create a draft branch with intent template
- `satisfied` — finalize intent, capture diff, port to `relay-patch/main`, tag
- `import <github-url>` — import a patch from another user's `.relay-patch`
- `re-derive <patch-id>` — generate re-derivation context bundle
- `apply <bundle-path>` — apply realization from bundle with verify gate
- `drift-check` — detect drift with target_area cost optimization
- `watch [--once] [--interval N]` — daemon: detect → bundle → apply loop
- `update [--tag]` — consumer: advance to latest tag
- `rollback` — consumer: roll back to previous tag
- `status` — show current state
- OpenCode skill at `.opencode/skills/relay-patch/SKILL.md` for AI-assisted
  DRAFTING and RE-DERIVATION
- Docker-based orchestrator test in `Dockerfile` + `test-orchestrator.sh`

### Validated

5 cold-start LLM tests documented in `_local/`:
- Single-patch drift re-derivation
- Multi-patch sibling awareness
- Drift-with-siblings sequential re-derivation
- CLI consumer prototype
- Producer-side commands

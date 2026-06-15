# relay-patch

Keep up-to-date upstream + your custom patches. A workflow + tool for fork users
who want both.

## Status: v0.1.0 (prototype)

The CLI prototype is functional but minimal. The full design is documented in
`_local/`. Three end-to-end cold-start LLM tests have validated the core design:
single-patch drift, multi-patch sibling awareness, and drift-with-siblings
sequential re-derivation.

## What it does

`relay-patch` lets you maintain a fork of an upstream repo with your custom
patches, where **patches are intent (not diffs)**. An AI agent re-derives
your patches against every upstream release, so you stay up-to-date without
losing your features.

## For users (CLI)

Run from within your fork's checkout directory:

```bash
# See current state
bun run src/cli.ts status

# Update to the latest re-derivation
bun run src/cli.ts update

# Update to a specific version
bun run src/cli.ts update --tag v2.1.0-rp1

# Roll back to the previous version
bun run src/cli.ts rollback

# Show help
bun run src/cli.ts --help
```

Tags follow the convention `v<upstream-version>-rp<build-number>` (e.g.,
`v2.1.0-rp1`). Each successful re-derivation produces a new tag.

### Flags

- `--tag <name>` — update to a specific tag (default: latest)
- `--dry-run` — show what would happen, don't actually change anything
- `--skip-install` — skip `bun install` after checkout (useful for testing)

## How it works

The tool is a thin wrapper around git:

1. `relay-patch update` fetches the latest tags, finds the most recent
   `v*-rp*`, stashes any local changes, checks out that tag, and runs
   `bun install`.
2. `relay-patch rollback` does the same but for the previous tag in the
   semver-sorted list.

The force-push rebuild model for `relay-patch/main` means raw `git pull`
would break. The CLI is the only safe way to advance.

## For developers

The design is in `_local/`:
- `2026-06-14-v2.md` — full design (state machine, repo layout, AI contract)
- `2026-06-14-dry-run-findings.md` — initial dry-run results
- `2026-06-14-cold-start-test.md` — single-patch drift validation
- `2026-06-14-multi-patch-test.md` — sibling awareness validation
- `2026-06-14-drift-siblings-test.md` — drift-with-siblings validation
- `2026-06-14-cli-prototype.md` — CLI prototype results (this iteration)

A live demo of the full flow lives in:
- Upstream: https://github.com/ImBIos/guess-my-number
- Dry-run fork and intent repo: `/home/imbios/dev/projects/dry-run/`

## Development

```bash
pnpm install
bun run src/cli.ts status
```

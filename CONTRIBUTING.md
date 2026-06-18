# Contributing

Thanks for your interest in relay-patch!

## Development setup

```bash
pnpm install
bun run src/cli.ts status  # smoke test
```

## Running tests

```bash
# Type check
bunx tsc --noEmit

# Docker orchestrator test (isolated)
docker build -t relay-patch-test .
docker run --rm relay-patch-test
```

## Architecture

The design is documented in `_local/`:

- `2026-06-14-v2.md` — full design (state machine, repo layout, AI contract)
- `2026-06-14-*.md` — test results and findings

## Code structure

```
src/
├── cli.ts        # command routing
├── watch.ts      # daemon loop
├── verify.ts     # verification gate
├── drift-check.ts
├── re-derive.ts  # context bundle generation
├── apply.ts      # context bundle consumption
├── import.ts
├── satisfied.ts
├── draft.ts
├── init.ts
├── update.ts
├── rollback.ts
├── git.ts        # shared git utilities
├── patch-id.ts   # slug + ULID8 generation
└── status.ts     # (currently in cli.ts)
```

## Conventions

- All commands follow `command <args> [--flags]` pattern
- Errors are caught in `cli.ts` and printed with context
- TypeScript strict mode (`noUncheckedIndexedAccess`)
- No external runtime dependencies (Bun stdlib only)

## Submitting changes

1. Fork the repo
2. Create a feature branch
3. Run `bunx tsc --noEmit` and the Docker test
4. Submit a PR with a clear description

## Release process

Releases are triggered by pushing a tag. The GitHub Actions workflow in
`.github/workflows/publish.yml` handles publishing.

```bash
# Bump version in package.json
# Commit the change
git tag v0.2.3
git push origin v0.2.3
# Workflow runs: npm publish (with provenance) + GitHub Packages + GitHub Release
```

### First release / trusted publishing setup

For provenance to work from CI, you need to set up **npm trusted publishing**:

1. First publish manually once: `npm login` then `npm publish --provenance`
2. Go to https://www.npmjs.com/package/relay-patch → Settings → Trusted publishing
3. Add a trusted publisher:
   - Provider: GitHub Actions
   - Repository: `ImBIOS/relay-patch`
   - Workflow filename: `publish.yml`
4. Future releases will publish from CI with provenance automatically

## Questions

Open an issue or discussion on GitHub.

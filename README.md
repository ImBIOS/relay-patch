# relay-patch

**Keep up-to-date upstream + your custom patches. Patches are intent, not diffs.**

```bash
$ npx relay-patch init
$ relay-patch draft "add --cheat flag to reveal the secret"
# ... AI implements, you test ...
$ relay-patch satisfied
$ relay-patch update  # when upstream releases
```

You maintain a fork. The maintainer rejected your PR. You want both their fixes
AND your feature. **Now you can have both.**

## The problem

```
upstream/main    ─────●─────●─────●─────►  (v1.0.0, v1.1.0, v2.0.0, v2.1.0)
                               │
                               └─ your patch: --cheat flag (rejected PR)
                                  
your fork       ─────●─────●─────●─────►  (frozen at v2.0.0 + your patch)
                                  
gap: v2.1.0 features you don't have
```

**Today:** choose — official release (lose your patch) or your fork (lose upstream features).
The pain: every upstream release, manually re-apply, re-fix, re-test.

**With relay-patch:** declare your patch as **intent** ("add --cheat flag, print before banner, don't touch game.ts"). An AI agent re-realizes your intent against every new upstream release. You run `relay-patch update` and get both: your patch + the latest upstream.

## Install

### Homebrew (macOS / Linux)

```bash
brew tap ImBIOS/tap
brew install relay-patch
```

### npm

```bash
npm install -g relay-patch
# or
bun add -g relay-patch
# or
npx relay-patch init
```

### Standalone binary

```bash
curl -fsSL https://github.com/ImBIOS/relay-patch/releases/latest/download/relay-patch-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/') -o relay-patch
chmod +x relay-patch
sudo mv relay-patch /usr/local/bin/
```

### From source

```bash
git clone https://github.com/ImBIOS/relay-patch
cd relay-patch
bun install
bun run build:binaries  # → ./dist/relay-patch-*
```

Requires [Bun](https://bun.sh) ≥ 1.3 and `git`.

## Quick start

```bash
# 1. From inside your fork's checkout
relay-patch init

# 2. In OpenCode, run the slash command to create a patch
/relay-patch "add --cheat flag to reveal the secret number"

# 3. AI implements on a draft branch. Test it. When happy:
relay-patch satisfied

# 4. When upstream releases a new version:
relay-patch update    # consumer-side: advance to latest tag
relay-patch watch     # daemon-side: auto-detect drift, generate bundles, apply
```

## Commands

| Command | Purpose |
|---|---|
| `init` | Set up `.relay-patch` repo + config |
| `draft "<intent>"` | Create a `*` branch + draft INTENT.md |
| `satisfied` | Finalize intent, capture diff, port to `relay-patch/main`, tag |
| `import <github-url>` | Import a patch from another user's `.relay-patch` |
| `re-derive <patch-id>` | Generate context bundle for AI re-derivation |
| `apply <bundle-path>` | Apply realization from bundle (with verify gate) |
| `drift-check` | Detect drift (with target_area skip for cost optimization) |
| `watch [--once] [--interval N]` | Daemon: auto-detect drift + generate bundles + apply |
| `update [--tag <tag>]` | Consumer: advance to latest tag |
| `rollback` | Consumer: roll back to previous tag |
| `status` | Show current state |

## How it works

```
USERNAME/.relay-patch/         # intent repository (intent = truth)
├── repos/
│   └── github.com/owner/repo/
│       ├── manifest.json
│       └── patches/
│           └── <patch-id>/
│               ├── INTENT.md         # natural language intent
│               ├── ACCEPTANCE.md     # verification criteria
│               ├── reference.diff    # last successful realization (evidence)
│               ├── verify.sh         # runnable verification script
│               └── attempts.jsonl    # history (learn from failures)
└── watch-state.json

USER/repo/                       # your fork
├── main                          # tracks upstream
├── relay-patch/main              # built artifact, force-pushed
└── *                             # draft branch (per patch)
```

The core invariant: **intent is truth, diffs are evidence.** When upstream
releases v2.1.0, the reference.diff goes stale. The AI re-reads INTENT.md and
re-realizes against new upstream. Same intent, fresh implementation.

## Why this works

- **Intent survives drift.** A good INTENT.md is a specification, not a diff.
  Re-deriving from intent gives the AI freedom to adapt.
- **Drift detection is cheap.** `git log <last_realized>..<upstream> -- <target_area>`
  tells you if the relevant area changed. Most updates touch nothing important.
- **Verification is mandatory.** Each patch has a `verify.sh` runnable on apply.
  Failed verification = no auto-promote.
- **Sibling awareness.** When re-deriving patch B, the AI sees patch A's realization
  in the bundle and preserves it.

## Re-using patches

Anyone can publish patches by making their `.relay-patch` public. Import
someone's:

```bash
relay-patch import https://github.com/ALICE/.relay-patch/blob/main/repos/\
github.com/owner/repo/patches/<patch-id>/INTENT.md
```

The patch is copied with author attribution. Re-derivation adapts it to your
fork's current state.

## The watch daemon

```bash
relay-patch watch --interval 300  # check every 5 minutes
```

Loops:
1. Detect drift (per-patch target_area check, skip if untouched)
2. Generate context bundle for drifted patches
3. Wait for AI to produce REALIZATION/realization.diff
4. Apply with verify gate
5. Tag

Run with `--once` for cron/CI. Without it, the daemon loops with sleep.

## Validated by 5 cold-start LLM tests

Single-patch drift, multi-patch sibling awareness, drift-with-siblings sequential
re-derivation, CLI consumer prototype, producer-side commands. All documented in
`_local/`.

## Development

```bash
pnpm install
bun run src/cli.ts status
```

## License

MIT

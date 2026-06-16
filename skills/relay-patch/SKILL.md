# relay-patch

## Description

Manage patches for forked repositories using intent-based re-derivation. Use when the user wants to create a patch, finalize a patch, check for drift, or re-derive patches against new upstream releases.

## When to Use

- User says `/relay-patch "<intent>"` — create a new patch (DRAFTING)
- User says they're satisfied with a patch — finalize it
- User wants to check if patches need re-derivation — drift-check
- User wants to re-derive patches against new upstream

## DRAFTING Flow (`/relay-patch "<intent>"`)

When the user invokes `/relay-patch "<intent description>"`:

### Step 1: Create draft

```bash
bun run <relay-patch-cli> draft "<intent>"
```

This creates a `*` branch and a `.relay-patch-draft.md` file.

### Step 2: Read and understand

Read the draft file and the current source code. Understand what needs to change.

### Step 3: Implement

Implement the feature/fix described in the intent. Rules:
- Modify only files necessary for the patch
- Write clean, minimal code
- Do NOT modify files the intent says are off-limits
- Run `bun test` to verify existing tests pass

### Step 4: Fill INTENT.md sections

Edit `.relay-patch-draft.md` to fill in the template sections:

**## Why** — Why does the user want this? Why won't the maintainer merge it?

**## Non-negotiables** — What MUST be true? (e.g., "flag is opt-in", "game.ts not modified")

**## Implementation notes** — What did you do? Be specific:
- Which files changed and where
- What approach was taken and why
- Any gotchas for future re-derivation

Write these so a cold-start AI can re-derive the patch from INTENT.md alone.

### Step 5: User test

Tell the user: "Patch implemented on branch `<branch>`. Test it with: `<run command>`"

Ask if they're satisfied.

### Step 6a: Satisfied

If the user says they're satisfied:

```bash
bun run <relay-patch-cli> satisfied
```

This finalizes the intent, captures the diff, ports to `relay-patch/main`, and tags.

### Step 6b: Not satisfied

If the user wants changes:
- Make the requested changes
- Update the Implementation notes in `.relay-patch-draft.md`
- Re-test
- Ask again

## RE-DERIVATION Flow

When re-deriving a patch against new upstream (drift):

### Inputs you receive

1. **INTENT.md** — the source of truth (what to implement)
2. **reference.diff** — previous realization (HINT only, do NOT apply mechanically)
3. **drift-context.txt** — what changed in upstream + sibling patch state
4. **attempts.jsonl** — past attempts (learn from failures)
5. **Current source code** — the new upstream + siblings already applied

### Process

1. Read INTENT.md thoroughly — this is truth, not suggestion
2. Read drift-context.txt — understand what changed and where siblings are
3. Read reference.diff — understand the previous approach (do NOT `git apply`)
4. Read attempts.jsonl — avoid approaches that previously failed
5. Implement the patch against the current codebase
6. Run verification: `bun test`
7. Check acceptance criteria from ACCEPTANCE.md
8. Verify sibling patches still work

### Constraints

- DO NOT apply reference.diff mechanically — re-derive from intent
- DO NOT modify files the INTENT says are off-limits
- DO NOT duplicate code that upstream or siblings already provide
- DO preserve sibling patches' code verbatim

### Output

Report:
- What files changed and the diff summary
- Test results
- Acceptance criteria pass/fail
- Sibling compatibility check
- Self-confidence (high/medium/low) and reasoning

## INTENT.md Quality Rules

The INTENT.md is the ONLY artifact that survives across re-derivations. It must be:

- **Self-contained**: an AI reading it cold (no project context) should understand exactly what to do
- **Specific**: "add --cheat flag that prints the secret before the banner" not "add cheat mode"
- **Constraint-heavy**: list what NOT to do (e.g., "DO NOT modify game.ts")
- **Implementation-aware**: note where code was inserted, what approach was taken, and why
- **Pitfall-aware**: after iterations, add "Pitfalls" section with what NOT to try

Bad intent: "make the game easier"
Good intent: "add --hint flag that shows narrowed range (guess+1 to max, or min to guess-1) after each wrong guess"

## CLI Location

The relay-patch CLI is at the project root:
```
bun run src/cli.ts <command>
```

Or if installed globally:
```
relay-patch <command>
```

## Commands Reference

| Command | Purpose |
|---|---|
| `init [--target <repo>]` | Set up .relay-patch repo |
| `draft "<intent>"` | Create draft branch |
| `satisfied [--skip-port]` | Finalize intent, port, tag |
| `status` | Show current tag state |
| `update [--tag <tag>]` | Consumer: advance to tag |
| `rollback` | Consumer: roll back |

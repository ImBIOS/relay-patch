#!/bin/bash
# Isolated orchestrator test — runs entirely inside the container
# Tests: init → draft → satisfied → re-derive → bundle verification

set -e

WS=/workspace
UPSTREAM=$WS/upstream
FORK=$WS/fork
RP=$WS/.relay-patch

# Configure git for the container
git config --global user.email "test@relay-patch"
git config --global user.name "relay-patch test"
git config --global init.defaultBranch main

echo "============================================"
echo "  relay-patch orchestrator test (in Docker)"
echo "============================================"
echo ""

# === Setup: create a minimal upstream repo ===
echo "--- Setup: creating minimal upstream repo ---"
mkdir -p $UPSTREAM
cd $UPSTREAM
cat > index.ts <<'EOF'
import { generateSecret, checkGuess } from "./game";

const SECRET = generateSecret();
let attempts = 0;

console.log("Guess the number (1-100):");

while (true) {
  const input = prompt("> ");
  if (input === null) break;
  const guess = parseInt(input, 10);
  if (isNaN(guess)) continue;

  attempts++;
  const result = checkGuess(guess, SECRET);
  if (result === "correct") {
    console.log(`Correct! ${attempts} attempts.`);
    break;
  }
  console.log(result === "higher" ? "Higher!" : "Lower!");
}
EOF
cat > game.ts <<'EOF'
export function generateSecret(): number {
  return Math.floor(Math.random() * 100) + 1;
}

export function checkGuess(guess: number, secret: number): "correct" | "higher" | "lower" {
  if (guess === secret) return "correct";
  return guess < secret ? "higher" : "lower";
}
EOF
cat > package.json <<'EOF'
{ "name": "test-game", "version": "1.0.0", "module": "index.ts", "type": "module" }
EOF
cat > README.md <<'EOF'
# Test game
EOF
git init -q
git add -A
git commit -q -m "v1.0.0"
git tag v1.0.0
echo "  upstream v1.0.0 created"

# === Clone as fork ===
echo ""
echo "--- Forking upstream ---"
git clone -q $UPSTREAM $FORK
cd $FORK
git remote rename origin upstream
git checkout -b main 2>/dev/null || git checkout main
echo "  fork created at $FORK"

# === Init relay-patch ===
echo ""
echo "--- Step 1: relay-patch init ---"
cd $FORK
bun /app/src/cli.ts init --target github.com/test/test-game 2>&1

# === Verify .relay-patch was created ===
echo ""
echo "--- Verify .relay-patch structure ---"
ls -la $RP/
echo ""
ls -la $RP/repos/github.com/test/test-game/

# === Create a test patch (simulating AI agent) ===
echo ""
echo "--- Step 2: create a draft ---"
bun /app/src/cli.ts draft "add a --debug flag" 2>&1

# === Manually implement (simulating AI output) ===
echo ""
echo "--- Step 3: implement the patch ---"
# We're now on a draft branch; implement
sed -i 's/console.log("Guess the number/console.log("Guess the number/' index.ts  # noop, just to ensure file
sed -i '/let attempts = 0;/a const DEBUG = process.argv.includes("--debug");' index.ts
sed -i '/console.log(`Correct!/i if (DEBUG) console.log("[DEBUG] enabled");' index.ts
git add -A
git commit -q -m "add --debug flag"
echo "  patch implemented and committed"

# === Finalize the patch ===
echo ""
echo "--- Step 4: relay-patch satisfied ---"
bun /app/src/cli.ts satisfied 2>&1

# === Simulate upstream advance ===
echo ""
echo "--- Step 5: simulate upstream advance ---"
cd $UPSTREAM
echo "// upstream v2.0.0: new feature" >> index.ts
git commit -aq -m "v2.0.0: new feature"
git tag v2.0.0
cd $FORK
git fetch upstream -q
echo "  upstream advanced to v2.0.0"

# === Check drift ===
echo ""
echo "--- Step 6: drift-check ---"
bun /app/src/cli.ts drift-check 2>&1

# === Re-derive the patch ===
echo ""
echo "--- Step 7: re-derive the patch ---"
# Get the patch ID from the manifest
PATCH_ID=$(ls $RP/repos/github.com/test/test-game/patches/ | head -1)
echo "  patch ID: $PATCH_ID"
bun /app/src/cli.ts re-derive "$PATCH_ID" 2>&1

# === Verify bundle ===
echo ""
echo "--- Step 8: verify bundle ---"
BUNDLE=$(find $RP/derive -type d -mindepth 2 -maxdepth 2 | sort | tail -1)
echo "  bundle: $BUNDLE"
echo "  bundle contents:"
find "$BUNDLE" -type f | sort | sed 's/^/    /'

# === Verify bundle has the expected files ===
echo ""
echo "--- Step 9: bundle structure validation ---"
EXPECTED_FILES=("INTENT.md" "ACCEPTANCE.md" "reference.diff" "attempts.jsonl" "drift-summary.txt" "README.md")
for f in "${EXPECTED_FILES[@]}"; do
  if [ -f "$BUNDLE/$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f MISSING"
    exit 1
  fi
done

# === Verify drift-summary.txt has upstream change info ===
echo ""
echo "--- Step 10: drift summary contents ---"
grep -A 2 "upstream" "$BUNDLE/drift-summary.txt" | head -5

# === Test apply with a simulated AI realization ===
echo ""
echo "--- Step 11: simulate AI realization and apply ---"
# Get the current reference.diff and adapt it for v2
ORIGINAL_DIFF="$RP/repos/github.com/test/test-game/patches/$PATCH_ID/reference.diff"
# Modify the line numbers for v2 (add some shift)
cp "$ORIGINAL_DIFF" "$BUNDLE/REALIZATION/realization.diff"
cat > "$BUNDLE/REALIZATION/report.md" <<'EOF'
# Re-derivation Report
## Approach
Piggybacked on existing pattern. Implementation verified by reading current source.
## Self-confidence
high
EOF
bun /app/src/cli.ts apply "$BUNDLE" --skip-tests 2>&1

# === Final verification ===
echo ""
echo "--- Step 12: final state ---"
echo "  manifest:"
cat "$RP/repos/github.com/test/test-game/manifest.json" | head -20
echo ""
echo "  tags:"
git tag -l 'v*-rp*'

echo ""
echo "============================================"
echo "  All tests passed!"
echo "============================================"

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitExec } from "./git";
import { runDriftCheck, formatDriftCheckResult, type DriftCheckResult } from "./drift-check";

export type WatchOptions = {
  relayPatchDir?: string;
  once?: boolean;
  interval?: number;
  agent?: string;
};

type WatchBundle = {
  patchId: string;
  bundlePath: string;
  generatedAt: string;
  status: "pending" | "applied" | "failed";
};

type WatchState = {
  lastCheck: string;
  bundles: WatchBundle[];
};

const STATE_FILE = "watch-state.json";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadWatchState(relayPatchDir: string): Promise<WatchState> {
  const statePath = join(relayPatchDir, STATE_FILE);
  if (!existsSync(statePath)) {
    return { lastCheck: "", bundles: [] };
  }
  return JSON.parse(readFileSync(statePath, "utf-8"));
}

async function saveWatchState(relayPatchDir: string, state: WatchState): Promise<void> {
  const statePath = join(relayPatchDir, STATE_FILE);
  await Bun.write(statePath, JSON.stringify(state, null, 2) + "\n");
}

async function checkBundleComplete(bundlePath: string): Promise<boolean> {
  return existsSync(join(bundlePath, "REALIZATION", "realization.diff"));
}

async function applyBundle(bundlePath: string, relayPatchDir: string): Promise<{ success: boolean; tag: string | null; errors: string[] }> {
  const { runApply } = await import("./apply");
  try {
    const result = await runApply(bundlePath, { relayPatchDir, skipTests: false });
    return { success: result.diffApplied, tag: result.tag, errors: result.errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, tag: null, errors: [msg] };
  }
}

type AgentCommand = {
  command: string;
  argsForBundle: (bundlePath: string, promptPath: string) => string[];
};

const AGENTS: Record<string, AgentCommand> = {
  opencode: {
    command: "opencode",
    argsForBundle: (bundlePath, promptPath) => [
      "--prompt", promptPath,
      "--output", `${bundlePath}/REALIZATION/`,
    ],
  },
  "claude-code": {
    command: "claude",
    argsForBundle: (bundlePath, promptPath) => [
      "--file", promptPath,
    ],
  },
};

async function invokeAgent(agentName: string, bundlePath: string, patchId: string): Promise<void> {
  const agent = AGENTS[agentName];
  if (!agent) {
    console.error(`\n✗ Unknown agent: ${agentName}. Available: ${Object.keys(AGENTS).join(", ")}`);
    return;
  }

  const promptPath = `${bundlePath}/prompt.md`;
  const realizationPath = `${bundlePath}/REALIZATION/realization.diff`;

  console.log(`\n🤖 Invoking ${agentName} on bundle for ${patchId}...`);

  try {
    const proc = Bun.spawn([agent.command, ...agent.argsForBundle(bundlePath, promptPath)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const fs = await import("node:fs");
      if (fs.existsSync(realizationPath)) {
        console.log(`✅ ${agentName} produced realization`);
      } else {
        console.log(`⚠ ${agentName} exited 0 but no realization.diff was produced`);
      }
    } else {
      console.error(`✗ ${agentName} failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`✗ Could not invoke ${agentName}: ${err instanceof Error ? err.message : err}`);
  }
}

export async function runWatch(options: WatchOptions = {}): Promise<void> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (!existsSync(relayPatchDir)) {
    throw new Error(".relay-patch repo not found. Run `relay-patch init` first.");
  }

  const intervalMs = (options.interval ?? 300) * 1000;
  const agent = options.agent;
  let iteration = 0;

  do {
    iteration++;
    const now = new Date();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  relay-patch watch — iteration ${iteration} — ${now.toISOString()}`);
    console.log(`${"=".repeat(60)}\n`);

    const driftResult = await runDriftCheck({ relayPatchDir });
    console.log(formatDriftCheckResult(driftResult));

    const state = await loadWatchState(relayPatchDir);

    const driftedPatches = driftResult.patches.filter((p) => p.status === "drifted");

    if (driftedPatches.length === 0 && state.bundles.length === 0) {
      console.log(`\n✓ All patches current. Nothing to do.`);
      if (!options.once) {
        console.log(`  Next check in ${intervalMs / 1000}s...`);
      }
    } else {
      for (const patch of driftedPatches) {
        const alreadyPending = state.bundles.some(
          (b) => b.patchId === patch.patchId && b.status === "pending",
        );
        if (alreadyPending) continue;

        try {
          const { runReDerive } = await import("./re-derive");
          const bundleResult = await runReDerive(patch.patchId, { relayPatchDir });
          if (bundleResult.status === "needs-derivation" && bundleResult.bundlePath) {
            state.bundles.push({
              patchId: patch.patchId,
              bundlePath: bundleResult.bundlePath,
              generatedAt: now.toISOString(),
              status: "pending",
            });
            console.log(`\n📦 Bundle generated for ${patch.patchId}`);
            console.log(`   ${bundleResult.bundlePath}`);

            if (agent) {
              await invokeAgent(agent, bundleResult.bundlePath, patch.patchId);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\n⚠ Could not generate bundle for ${patch.patchId}: ${msg}`);
        }
      }

      const stillPending: WatchBundle[] = [];
      for (const bundle of state.bundles) {
        if (bundle.status !== "pending") {
          stillPending.push(bundle);
          continue;
        }

        const isComplete = await checkBundleComplete(bundle.bundlePath);
        if (!isComplete) {
          stillPending.push(bundle);
          continue;
        }

        console.log(`\n🔧 AI realization found for ${bundle.patchId}. Applying...`);
        const applyOutcome = await applyBundle(bundle.bundlePath, relayPatchDir);
        if (applyOutcome.success) {
          bundle.status = "applied";
          console.log(`✅ ${bundle.patchId} applied successfully!`);
          if (applyOutcome.tag) console.log(`   Tagged: ${applyOutcome.tag}`);
        } else {
          bundle.status = "failed";
          console.error(`❌ ${bundle.patchId} apply failed:`);
          for (const err of applyOutcome.errors) console.error(`   ${err}`);
          stillPending.push(bundle);
        }
      }

      state.bundles = stillPending.filter((b) => b.status === "pending");
    }

    state.lastCheck = now.toISOString();
    await saveWatchState(relayPatchDir, state);

    if (state.bundles.length > 0) {
      console.log(`\n⏳ ${state.bundles.length} bundle(s) awaiting AI realization:`);
      for (const b of state.bundles) {
        const hasRealization = await checkBundleComplete(b.bundlePath);
        const icon = hasRealization ? "🔧" : "⏳";
        console.log(`   ${icon} ${b.patchId}`);
        console.log(`      ${b.bundlePath}`);
      }
      console.log(`\n   To process: run /relay-patch in your AI agent,`);
      console.log(`   or manually edit REALIZATION/realization.diff in the bundle.`);
    }

    if (options.once) {
      console.log(`\n--once mode: exiting after single iteration.`);
      break;
    }

    console.log(`\n  Sleeping ${intervalMs / 1000}s...\n`);
    await sleep(intervalMs);
  } while (!options.once);
}

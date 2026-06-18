import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  isGitRepo,
  gitOrThrow,
  gitExec,
  currentSha,
  shortSha,
  checkout,
} from "./git";

export type ApplyOptions = {
  relayPatchDir?: string;
  skipTests?: boolean;
  skipTag?: boolean;
};

export type ApplyResult = {
  bundlePath: string;
  patchId: string;
  diffApplied: boolean;
  testsPass: boolean;
  tag: string | null;
  errors: string[];
};

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

function readFrontmatterField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/["']/g, "") ?? null;
}

function extractPatchIdFromBundle(bundlePath: string): string | null {
  const segments = bundlePath.split("/");
  const deriveIdx = segments.lastIndexOf("derive");
  if (deriveIdx === -1 || deriveIdx === segments.length - 1) return null;
  return segments[deriveIdx + 1] ?? null;
}

async function runVerificationCommand(command: string, cwd: string): Promise<boolean> {
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function runApply(bundlePath: string, options: ApplyOptions = {}): Promise<ApplyResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const realizationDiffPath = join(bundlePath, "REALIZATION", "realization.diff");
  if (!existsSync(realizationDiffPath)) {
    throw new Error(
      `No realization found at ${realizationDiffPath}.\n` +
      `The AI should write its diff to REALIZATION/realization.diff in the bundle.`,
    );
  }

  const realizationDiff = readFileSync(realizationDiffPath, "utf-8");
  if (!realizationDiff.trim()) {
    throw new Error("REALIZATION/realization.diff is empty.");
  }

  const patchId = extractPatchIdFromBundle(bundlePath);
  if (!patchId) {
    throw new Error("Could not extract patch ID from bundle path.");
  }

  const intentPath = join(bundlePath, "INTENT.md");
  const verifyCommand = existsSync(intentPath)
    ? readFrontmatterField(readFileSync(intentPath, "utf-8"), "verifies_with")
    : null;

  const errors: string[] = [];
  let diffApplied = false;
  let testsPass = false;
  let tag: string | null = null;

  const rpMainExists = await gitExec(["rev-parse", "--verify", "relay-patch/main"]);
  if (rpMainExists.exitCode !== 0) {
    errors.push("relay-patch/main branch does not exist. Run `relay-patch satisfied` at least once first.");
    return { bundlePath, patchId, diffApplied, testsPass, tag, errors };
  }

  const previousBranch = await gitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"]);
  await checkout("relay-patch/main");

  try {
    const checkResult = await gitExec(["apply", "--check", realizationDiffPath]);
    if (checkResult.exitCode !== 0) {
      errors.push(`Diff does not apply: ${checkResult.stderr || checkResult.stdout}`);
      return { bundlePath, patchId, diffApplied, testsPass, tag, errors };
    }

    const applyResult = await gitExec(["apply", realizationDiffPath]);
    if (applyResult.exitCode !== 0) {
      errors.push(`Failed to apply: ${applyResult.stderr || applyResult.stdout}`);
      return { bundlePath, patchId, diffApplied, testsPass, tag, errors };
    }
    diffApplied = true;

    if (!options.skipTests) {
      const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
      let patchDir: string | null = null;
      const { existsSync: exists, readdirSync, statSync } = await import("node:fs");
      function findPatch(dir: string, targetId: string): string | null {
        if (!exists(dir)) return null;
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            if (entry === targetId) return full;
            const sub = findPatch(full, targetId);
            if (sub) return sub;
          }
        }
        return null;
      }
      patchDir = findPatch(join(relayPatchDir, "repos"), patchId);

      if (patchDir) {
        const { runVerify } = await import("./verify");
        const verifyResult = await runVerify(patchDir, process.cwd());
        testsPass = verifyResult.passed;
        if (!testsPass) {
          errors.push(`Verification failed:\n${verifyResult.output}`);
          await gitExec(["apply", "-R", realizationDiffPath]);
          return { bundlePath, patchId, diffApplied: false, testsPass, tag, errors };
        }
      } else if (verifyCommand) {
        testsPass = await runVerificationCommand(verifyCommand, process.cwd());
        if (!testsPass) {
          errors.push(`Verification command failed: ${verifyCommand}`);
          await gitExec(["apply", "-R", realizationDiffPath]);
          return { bundlePath, patchId, diffApplied: false, testsPass, tag, errors };
        }
      } else {
        testsPass = true;
      }
    } else {
      testsPass = true;
    }

    if (!options.skipTag) {
      const upstreamTagResult = await gitExec(["describe", "--tags", "--abbrev=0", "relay-patch/main"]);
      const upstreamTag = upstreamTagResult.exitCode === 0 ? upstreamTagResult.stdout : "v0.0.0";
      const rpTagsResult = await gitExec(["tag", "--list", `${upstreamTag}-rp*`]);
      const rpCount = rpTagsResult.stdout ? rpTagsResult.stdout.split("\n").filter(Boolean).length : 0;
      tag = `${upstreamTag}-rp${rpCount + 1}`;
      await gitOrThrow(["tag", tag]);
    }
  } finally {
    await checkout(previousBranch);
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (existsSync(relayPatchDir)) {
    const reposDir = join(relayPatchDir, "repos");
    const { readdirSync, statSync } = await import("node:fs");
    function findPatchDir(dir: string, targetPatchId: string): string | null {
      if (!existsSync(dir)) return null;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          if (entry === targetPatchId) return fullPath;
          const sub = findPatchDir(fullPath, targetPatchId);
          if (sub) return sub;
        }
      }
      return null;
    }
    const patchDir = findPatchDir(reposDir, patchId);
    if (patchDir) {
      const newRefDiffPath = join(patchDir, "reference.diff");
      await Bun.write(newRefDiffPath, realizationDiff);

      const newSha = shortSha(await currentSha());

      const manifestPath = join(patchDir, "..", "..", "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        if (manifest.patches?.[patchId]) {
          manifest.patches[patchId].last_realized_against_commit = newSha;
          manifest.patches[patchId].status = "applied";
          await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        }
      }

      const attemptsPath = join(patchDir, "attempts.jsonl");
      if (existsSync(attemptsPath)) {
        const attempts = readFileSync(attemptsPath, "utf-8");
        const newEntry = JSON.stringify({
          n: (attempts.split("\n").filter(Boolean).length) + 1,
          phase: "re-deriving",
          timestamp: new Date().toISOString(),
          upstream_sha: newSha,
          approach: "(from bundle — see REALIZATION/report.md)",
          result: testsPass ? "passed" : "failed",
          tokens: 0,
          model: "human-orchestrated",
          bundle: bundlePath,
        });
        await Bun.write(attemptsPath, attempts + (attempts.endsWith("\n") ? "" : "\n") + newEntry + "\n");
      }
    }
  }

  return { bundlePath, patchId, diffApplied, testsPass, tag, errors };
}

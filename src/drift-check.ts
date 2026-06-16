import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isGitRepo,
  gitOrThrow,
  gitExec,
  shortSha,
} from "./git";

export type DriftCheckOptions = {
  relayPatchDir?: string;
};

export type PatchDriftStatus = {
  patchId: string;
  status: "current" | "drifted" | "unknown";
  lastRealizedSha: string;
  targetArea: string[];
  upstreamChanged: boolean;
  targetAreaChanged: boolean;
  filesChangedInTargetArea: string[];
};

export type DriftCheckResult = {
  upstreamSha: string;
  lastKnownSha: string;
  upstreamAdvanced: boolean;
  patches: PatchDriftStatus[];
  summary: {
    total: number;
    current: number;
    drifted: number;
    wouldSkip: number;
  };
};

function readManifest(repoDir: string): any {
  const manifestPath = join(repoDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("manifest.json not found. Run `relay-patch init` first.");
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}

function readUpstreamConfig(repoDir: string): any {
  const upstreamJsonPath = join(repoDir, "upstream.json");
  if (!existsSync(upstreamJsonPath)) {
    throw new Error("upstream.json not found. Run `relay-patch init` first.");
  }
  return JSON.parse(readFileSync(upstreamJsonPath, "utf-8"));
}

function readIntentTargetArea(repoDir: string, patchId: string): string[] {
  const intentPath = join(repoDir, "patches", patchId, "INTENT.md");
  if (!existsSync(intentPath)) return [];
  const content = readFileSync(intentPath, "utf-8");
  const match = content.match(/^target_area:\s*\[(.+?)\]/m);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

async function findTargetRepo(relayPatchDir: string, forkCwd: string): Promise<string> {
  const { getRemoteUrl, listRemotes } = await import("./git");
  for (const remote of await listRemotes(forkCwd)) {
    const url = await getRemoteUrl(remote, forkCwd);
    if (!url) continue;
    let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      const targetRepo = `${match[1]}/${match[2]}`;
      if (existsSync(join(relayPatchDir, "repos", targetRepo, "manifest.json"))) return targetRepo;
    }
    match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
      const targetRepo = `${match[1]}/${match[2]}`;
      if (existsSync(join(relayPatchDir, "repos", targetRepo, "manifest.json"))) return targetRepo;
    }
  }
  const { readdirSync } = await import("node:fs");
  const reposDir = join(relayPatchDir, "repos");
  if (!existsSync(reposDir)) {
    throw new Error("No repos found in .relay-patch. Run `relay-patch init` first.");
  }
  for (const host of readdirSync(reposDir)) {
    for (const owner of readdirSync(join(reposDir, host))) {
      for (const repo of readdirSync(join(reposDir, host, owner))) {
        const targetRepo = `${host}/${owner}/${repo}`;
        if (existsSync(join(reposDir, targetRepo, "manifest.json"))) {
          return targetRepo;
        }
      }
    }
  }
  throw new Error("Could not determine target repo from .relay-patch.");
}

export async function runDriftCheck(options: DriftCheckOptions = {}): Promise<DriftCheckResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (!existsSync(relayPatchDir)) {
    throw new Error(".relay-patch repo not found. Run `relay-patch init` first.");
  }

  const targetRepo = await findTargetRepo(relayPatchDir, process.cwd());
  const repoDir = join(relayPatchDir, "repos", targetRepo);
  const manifest = readManifest(repoDir);
  const upstreamConfig = readUpstreamConfig(repoDir);

  const upstreamRemote = upstreamConfig.upstream_remote ?? "upstream";
  const upstreamBranch = `${upstreamRemote}/${manifest.upstream_main_branch ?? "main"}`;

  const fetchResult = await gitExec(["fetch", upstreamRemote, "--quiet"]);
  if (fetchResult.exitCode !== 0) {
    throw new Error(`Could not fetch from ${upstreamRemote}: ${fetchResult.stderr}`);
  }

  const upstreamSha = await gitOrThrow(["rev-parse", upstreamBranch]);
  const lastKnownSha = upstreamConfig.last_known_upstream_sha ?? upstreamSha;
  const upstreamAdvanced = shortSha(upstreamSha) !== shortSha(lastKnownSha);

  const patchIds = Object.keys(manifest.patches || {});
  const patchStatuses: PatchDriftStatus[] = [];

  for (const patchId of patchIds) {
    const patchInfo = manifest.patches[patchId];
    const lastRealizedSha = patchInfo.last_realized_against_commit;
    const targetArea = readIntentTargetArea(repoDir, patchId);

    let status: PatchDriftStatus["status"] = "unknown";
    let upstreamChanged = false;
    let targetAreaChanged = false;
    let filesChangedInTargetArea: string[] = [];

    if (!lastRealizedSha) {
      status = "drifted";
      upstreamChanged = true;
      targetAreaChanged = true;
      filesChangedInTargetArea = ["(imported — needs first realization)"];
    } else if (shortSha(lastRealizedSha) === shortSha(upstreamSha)) {
      status = "current";
    } else {
      upstreamChanged = true;
      if (targetArea.length > 0) {
        const areaArgs = targetArea.flatMap((a) => ["--", a]);
        const diffResult = await gitExec([
          "diff", "--name-only", `${lastRealizedSha}..${upstreamSha}`, ...areaArgs,
        ]);
        filesChangedInTargetArea = diffResult.stdout
          ? diffResult.stdout.split("\n").filter(Boolean)
          : [];

        if (filesChangedInTargetArea.length > 0) {
          status = "drifted";
          targetAreaChanged = true;
        } else {
          status = "current";
        }
      } else {
        status = "drifted";
        targetAreaChanged = true;
      }
    }

    patchStatuses.push({
      patchId,
      status,
      lastRealizedSha,
      targetArea,
      upstreamChanged,
      targetAreaChanged,
      filesChangedInTargetArea,
    });
  }

  const summary = {
    total: patchStatuses.length,
    current: patchStatuses.filter((p) => p.status === "current").length,
    drifted: patchStatuses.filter((p) => p.status === "drifted").length,
    wouldSkip: patchStatuses.filter((p) => p.status === "current" && p.upstreamChanged).length,
  };

  return {
    upstreamSha,
    lastKnownSha,
    upstreamAdvanced,
    patches: patchStatuses,
    summary,
  };
}

export function formatDriftCheckResult(result: DriftCheckResult): string {
  const lines: string[] = [];

  lines.push(`Upstream:  ${shortSha(result.upstreamSha)} ${result.upstreamAdvanced ? `(advanced from ${shortSha(result.lastKnownSha)})` : "(unchanged)"}`);
  lines.push("");

  if (result.patches.length === 0) {
    lines.push("No patches found.");
    return lines.join("\n");
  }

  for (const patch of result.patches) {
    const icon = patch.status === "current" ? "✓" : patch.status === "drifted" ? "⚠" : "?";
    lines.push(`${icon} ${patch.patchId}`);
    lines.push(`   status:     ${patch.status}`);
    lines.push(`   realized:   ${patch.lastRealizedSha ? shortSha(patch.lastRealizedSha) : "(not yet realized)"}`);
    lines.push(`   target_area: [${patch.targetArea.join(", ")}]`);

    if (patch.status === "drifted") {
      lines.push(`   changed:    ${patch.filesChangedInTargetArea.join(", ")}`);
    } else if (patch.status === "current" && patch.upstreamChanged) {
      lines.push(`   skip:       target_area untouched (0 tokens)`);
    }
    lines.push("");
  }

  lines.push(`Summary: ${result.summary.total} patches, ${result.summary.current} current, ${result.summary.drifted} drifted`);
  if (result.summary.wouldSkip > 0) {
    lines.push(`         ${result.summary.wouldSkip} would be skipped (target_area untouched)`);
  }

  if (result.summary.drifted > 0) {
    lines.push(`\nAction: ${result.summary.drifted} patch(es) need re-derivation.`);
  } else {
    lines.push(`\nAll patches current. No action needed.`);
  }

  return lines.join("\n");
}

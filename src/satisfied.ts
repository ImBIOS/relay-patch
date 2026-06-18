import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  isGitRepo,
  gitOrThrow,
  gitExec,
  currentBranch,
  currentSha,
  diff,
  diffNameOnly,
  shortSha,
  checkout,
  cherryPick,
} from "./git";
import { slugify, generateULID8 } from "./patch-id";
import type { InitOptions } from "./init";

export type SatisfiedOptions = {
  relayPatchDir?: string;
  targetRepo?: string;
  skipPort?: boolean;
};

export type SatisfiedResult = {
  patchId: string;
  branch: string;
  filesChanged: string[];
  relayPatchMainUpdated: boolean;
  tag: string | null;
};

const DRAFT_FILE = ".relay-patch-draft.md";

function parseDraft(content: string): { slug: string; intent: string; baseSha: string } {
  const slugMatch = content.match(/^slug:\s*(.+)$/m);
  const intentMatch = content.match(/^intent:\s*(.+)$/m);
  const baseShaMatch = content.match(/^base_sha:\s*(.+)$/m);

  const slugStr = slugMatch?.[1];
  const intentStr = intentMatch?.[1];
  if (!slugStr || !intentStr) {
    throw new Error("Invalid draft file. Missing slug or intent in frontmatter.");
  }

  return {
    slug: slugStr.trim(),
    intent: intentStr.trim(),
    baseSha: baseShaMatch?.[1]?.trim() ?? "",
  };
}

async function findTargetRepo(relayPatchDir: string, forkCwd: string): Promise<string> {
  if (existsSync(join(relayPatchDir, "repos"))) {
    const reposDir = join(relayPatchDir, "repos");
    // Try to match by upstream remote URL
    const { getRemoteUrl, listRemotes } = await import("./git");
    for (const remote of await listRemotes(forkCwd)) {
      const url = await getRemoteUrl(remote, forkCwd);
      if (!url) continue;
      // Parse URL to path
      let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
      if (match) {
        const targetRepo = `${match[1]}/${match[2]}`;
        if (existsSync(join(reposDir, targetRepo))) return targetRepo;
      }
      match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
      if (match) {
        const targetRepo = `${match[1]}/${match[2]}`;
        if (existsSync(join(reposDir, targetRepo))) return targetRepo;
      }
    }
    // Fallback: use the first repo found
    const { readdirSync } = await import("node:fs");
    const hosts = readdirSync(reposDir);
    for (const host of hosts) {
      const owners = readdirSync(join(reposDir, host));
      for (const owner of owners) {
        const repos = readdirSync(join(reposDir, host, owner));
        for (const repo of repos) {
          const targetRepo = `${host}/${owner}/${repo}`;
          if (existsSync(join(reposDir, targetRepo, "manifest.json"))) {
            return targetRepo;
          }
        }
      }
    }
  }
  throw new Error("Could not determine target repo. Run `relay-patch init` first.");
}

export async function runSatisfied(options: SatisfiedOptions = {}): Promise<SatisfiedResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (!existsSync(relayPatchDir)) {
    throw new Error(".relay-patch repo not found. Run `relay-patch init` first.");
  }

  const draftPath = join(process.cwd(), DRAFT_FILE);
  if (!existsSync(draftPath)) {
    throw new Error("No draft file found. Run `relay-patch draft \"<intent>\"` first.");
  }

  const branch = await currentBranch();
  if (branch === "main" || branch === "master" || branch === "relay-patch/main") {
    throw new Error(`On branch '${branch}'. Switch to your draft branch first.`);
  }

  const draftContent = await Bun.file(draftPath).text();
  const { slug, intent } = parseDraft(draftContent);
  const patchId = `${slug}-${generateULID8()}`;

  const targetRepo = options.targetRepo ?? (await findTargetRepo(relayPatchDir, process.cwd()));
  const repoDir = join(relayPatchDir, "repos", targetRepo);
  if (!existsSync(repoDir)) {
    throw new Error(`Target repo directory not found: ${repoDir}. Run \`relay-patch init\` first.`);
  }

  const patchDir = join(repoDir, "patches", patchId);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(patchDir, { recursive: true });

  const upstreamSha = await gitOrThrow(["rev-parse", "origin/main"]).catch(() =>
    gitOrThrow(["rev-parse", "main"]),
  );
  const filesChanged = await diffNameOnly(upstreamSha, "HEAD");
  const realizationDiff = await diff(
    upstreamSha,
    "HEAD",
    process.cwd(),
    ":(exclude).gitignore",
    ":(exclude).relay-patch-draft.md",
  );

  const username = await gitOrThrow(["config", "user.name"]).catch(() => "unknown");
  const now = new Date().toISOString();

  await Bun.write(
    join(patchDir, "INTENT.md"),
    `---
id: ${patchId}
title: ${intent}
target_repo: ${targetRepo}
target_area: [${filesChanged.join(", ")}]
status: applied
applied_upstream_pr: none
version: 1
license: MIT
author: ${username}
last_modified_by: ${username}
owners: [${username}]
source_url: null
imported_at: null
created: ${now.split("T")[0]}
last_realized_against_commit: ${shortSha(upstreamSha)}
verifies_with: bun test
---

## Intent

${intent}

## Why

(Filled by user)

## Non-negotiables

(Filled by user)

## Implementation notes

(Filled by user — describe what was done)
`,
  );

  await Bun.write(join(patchDir, "reference.diff"), realizationDiff + "\n");

  await Bun.write(
    join(patchDir, "attempts.jsonl"),
    JSON.stringify({
      n: 1,
      phase: "drafting",
      timestamp: now,
      upstream_sha: shortSha(upstreamSha),
      approach: intent,
      result: "passed",
      tokens: 0,
      model: "manual",
    }) + "\n",
  );

  await Bun.write(
    join(patchDir, "ACCEPTANCE.md"),
    `# Acceptance Criteria — ${patchId}

## Must pass for promotion to APPLIED

1. **Default behavior unchanged**: running the code without any patch-specific flags
   produces identical output to upstream.

2. **Patch works**: the feature/fix described in INTENT.md functions correctly.

3. **Existing tests pass**: \`bun test\` exits 0.

4. **No unintended file changes**: only the files listed in target_area are modified.

## How to verify

\`\`\`bash
bun test
\`\`\`
`,
  );

  const { generateVerifySh } = await import("./verify");
  await Bun.write(
    join(patchDir, "verify.sh"),
    generateVerifySh("bun test", patchId),
  );

  const manifestPath = join(repoDir, "manifest.json");
  const manifest = JSON.parse(await Bun.file(manifestPath).text());
  manifest.patches[patchId] = {
    status: "applied",
    version: 1,
    author: username,
    last_modified_by: username,
    last_realized_against_commit: shortSha(upstreamSha),
  };
  manifest.apply_order.push(patchId);
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  let relayPatchMainUpdated = false;
  let tag: string | null = null;

  if (!options.skipPort) {
    const rpBranchResult = await gitExec(["rev-parse", "--verify", "relay-patch/main"]);
    if (rpBranchResult.exitCode !== 0) {
      await gitOrThrow(["branch", "relay-patch/main", upstreamSha]);
    }
    await checkout("relay-patch/main");
    try {
      await cherryPick(branch);
      relayPatchMainUpdated = true;

      const upstreamTagResult = await gitExec(["describe", "--tags", "--abbrev=0", upstreamSha]);
      const upstreamTag = upstreamTagResult.exitCode === 0 ? upstreamTagResult.stdout : "v0.0.0";

      const rpTagsResult = await gitExec(["tag", "--list", `${upstreamTag}-rp*`]);
      const rpCount = rpTagsResult.stdout ? rpTagsResult.stdout.split("\n").length : 0;
      tag = `${upstreamTag}-rp${rpCount + 1}`;
      await gitOrThrow(["tag", tag]);
    } catch (err) {
      await gitExec(["cherry-pick", "--abort"]);
      throw new Error(`Cherry-pick failed (sibling conflict?). Patch saved to .relay-patch but NOT ported to relay-patch/main. Use --skip-port to save without porting. Error: ${err instanceof Error ? err.message : err}`);
    }

    await checkout(branch);
  }

  rmSync(draftPath);

  return {
    patchId,
    branch,
    filesChanged,
    relayPatchMainUpdated,
    tag,
  };
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitExec, gitOrThrow, currentBranch, getRemoteUrl, listRemotes } from "./git";

export type PrOptions = {
  relayPatchDir?: string;
  targetRepo?: string;
  title?: string;
  body?: string;
  base?: string;
  draft?: boolean;
  noPush?: boolean;
};

export type PrResult = {
  branch: string;
  pushedTo: string;
  prUrl: string | null;
  prNumber: number | null;
  error: string | null;
};

async function findTargetRepo(relayPatchDir: string, forkCwd: string): Promise<string> {
  if (existsSync(join(relayPatchDir, "repos"))) {
    const reposDir = join(relayPatchDir, "repos");
    for (const remote of await listRemotes(forkCwd)) {
      const url = await getRemoteUrl(remote, forkCwd);
      if (!url) continue;
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

async function loadManifest(relayPatchDir: string, targetRepo: string): Promise<any> {
  const manifestPath = join(relayPatchDir, "repos", targetRepo, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}. Run \`relay-patch init\` first.`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

async function runGh(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function saveManifest(relayPatchDir: string, targetRepo: string, manifest: any): void {
  const manifestPath = join(relayPatchDir, "repos", targetRepo, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export async function runPr(options: PrOptions = {}): Promise<PrResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (!existsSync(relayPatchDir)) {
    throw new Error(".relay-patch repo not found. Run `relay-patch init` first.");
  }

  const targetRepo = options.targetRepo ?? (await findTargetRepo(relayPatchDir, process.cwd()));
  const repoDir = join(relayPatchDir, "repos", targetRepo);

  const manifest = await loadManifest(relayPatchDir, targetRepo);
  if (!manifest.is_fork) {
    throw new Error(
      "This repo isn't configured as a fork. `relay-patch pr` requires separate `upstream` and `origin` remotes.",
    );
  }
  if (!manifest.fork_remote) {
    throw new Error("manifest.fork_remote is not set. Re-run `relay-patch init`.");
  }

  const branch = await currentBranch();
  if (branch === "main" || branch === "master" || branch === "relay-patch/main") {
    throw new Error(`On branch '${branch}'. Switch to your draft branch first.`);
  }

  const forkRemote = manifest.fork_remote as string;
  const upstreamRemote = (manifest.upstream_remote as string) ?? "upstream";

  if (!options.noPush) {
    const pushResult = await gitExec(["push", "-u", forkRemote, branch]);
    if (pushResult.exitCode !== 0) {
      throw new Error(
        `git push failed: ${pushResult.stderr || pushResult.stdout}\n` +
          `Make sure '${forkRemote}' remote points to your fork.`,
      );
    }
  }

  const patchDir = join(repoDir, "patches");
  const intentPath = join(patchDir, branch, "INTENT.md");
  let prTitle = options.title;
  let prBody = options.body;
  if (!prTitle || !prBody) {
    if (existsSync(intentPath)) {
      const intentContent = readFileSync(intentPath, "utf8");
      if (!prTitle) {
        const titleMatch = intentContent.match(/^title:\s*(.+)$/m);
        if (titleMatch && titleMatch[1]) prTitle = titleMatch[1].trim();
      }
      if (!prBody) {
        const sections: string[] = [];
        const intentMatch = intentContent.match(/## Intent\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
        if (intentMatch && intentMatch[1]) sections.push(`## Intent\n\n${intentMatch[1].trim()}`);
        const nonNegMatch = intentContent.match(/## Non-negotiables\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
        if (nonNegMatch && nonNegMatch[1]) sections.push(`## Non-negotiables\n\n${nonNegMatch[1].trim()}`);
        if (sections.length > 0) {
          prBody = sections.join("\n\n") + "\n\n---\n\nManaged via [relay-patch](https://github.com/ImBIOS/relay-patch).";
        }
      }
    }
  }
  if (!prTitle) prTitle = branch;
  if (!prBody) prBody = "Managed via [relay-patch](https://github.com/ImBIOS/relay-patch).";

  const base = options.base ?? "main";
  const draftFlag = options.draft ? "--draft" : "";
  const args = [
    "pr", "create",
    "--base", base,
    "--head", branch,
    "--repo", targetRepo,
    "--title", prTitle,
    "--body", prBody,
  ];
  if (draftFlag) args.push(draftFlag);

  const ghResult = await runGh(args);
  if (ghResult.exitCode === 127 || (ghResult.stderr && ghResult.stderr.includes("not found"))) {
    const fallback = await gitExec(args);
    if (fallback.exitCode !== 127) {
      Object.assign(ghResult, { stdout: fallback.stdout, stderr: fallback.stderr, exitCode: fallback.exitCode });
    }
  }


  let prUrl: string | null = null;
  let prNumber: number | null = null;
  let error: string | null = null;

  if (ghResult.exitCode === 0) {
    prUrl = ghResult.stdout.trim() || null;
    if (prUrl) {
      const numMatch = prUrl.match(/\/pull\/(\d+)/);
      if (numMatch && numMatch[1]) prNumber = parseInt(numMatch[1], 10);
    }
  } else {
    error = ghResult.stderr || ghResult.stdout;
    if (error.includes("already exists") || error.includes("A pull request already exists")) {
      const existingResult = await gitExec(["pr", "view", branch, "--json", "url,number", "--jq", ".url,.number"]);
      if (existingResult.exitCode === 0) {
        const lines = existingResult.stdout.trim().split("\n");
        if (lines[0]) prUrl = lines[0];
        if (lines[1]) prNumber = parseInt(lines[1], 10);
        error = null;
      }
    }
  }

  if (prNumber) {
    const manifest2 = await loadManifest(relayPatchDir, targetRepo);
    let patchId: string | null = null;
    for (const [id, p] of Object.entries(manifest2.patches)) {
      if ((p as any).branch === branch) {
        patchId = id;
        break;
      }
    }
    if (patchId && manifest2.patches[patchId]) {
      manifest2.patches[patchId].applied_upstream_pr = {
        number: prNumber,
        url: prUrl,
        state: "open",
      };
      saveManifest(relayPatchDir, targetRepo, manifest2);
    }
  }

  return {
    branch,
    pushedTo: options.noPush ? "(no push)" : `${forkRemote}/${branch}`,
    prUrl,
    prNumber,
    error,
  };
}

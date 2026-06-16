import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  gitExec,
  gitOrThrow,
  getRemoteUrl,
  listRemotes,
  isGitRepo,
} from "./git";

export type InitOptions = {
  relayPatchDir?: string;
  upstreamRemote?: string;
  target?: string;
};

export type InitResult = {
  targetRepo: string;
  relayPatchDir: string;
  upstreamRemote: string;
  upstreamUrl: string;
  created: boolean;
};

function parseRemoteUrl(url: string): string | null {
  let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  return null;
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run `relay-patch init` from inside your fork's checkout.");
  }

  const upstreamRemote = options.upstreamRemote ?? "upstream";
  const remotes = await listRemotes();

  let remoteName = upstreamRemote;
  if (!remotes.includes(remoteName)) {
    if (remotes.includes("origin")) {
      remoteName = "origin";
    } else {
      throw new Error(`No git remote named '${upstreamRemote}' or 'origin'. Set up an upstream remote first.`);
    }
  }

  const upstreamUrl = await getRemoteUrl(remoteName);
  if (!upstreamUrl) {
    throw new Error(`Could not get URL for remote '${remoteName}'.`);
  }

  const targetRepo = options.target ?? parseRemoteUrl(upstreamUrl);
  if (!targetRepo) {
    throw new Error(
      `Could not parse remote URL: ${upstreamUrl}\n` +
      `Use --target <github.com/owner/repo> to specify manually.`,
    );
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  const alreadyExists = existsSync(join(relayPatchDir, ".git"));
  const created = !alreadyExists;

  if (!alreadyExists) {
    mkdirSync(relayPatchDir, { recursive: true });
    await gitOrThrow(["init", "--quiet"], relayPatchDir);
  }

  const repoDir = join(relayPatchDir, "repos", targetRepo);
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, "patches"), { recursive: true });

  const globalJsonPath = join(relayPatchDir, "global.json");
  if (!existsSync(globalJsonPath)) {
    const username = await gitOrThrow(["config", "user.name"]).catch(() => "unknown");
    await Bun.write(
      globalJsonPath,
      JSON.stringify(
        {
          user: username,
          default_agent: "opencode",
          token_budget_per_run: 500000,
          on_budget_exceed: "pause",
          cost_tracking: true,
        },
        null,
        2,
      ) + "\n",
    );
  }

  const upstreamJsonPath = join(repoDir, "upstream.json");
  if (!existsSync(upstreamJsonPath)) {
    const upstreamSha = await gitExec(["rev-parse", "HEAD"]).then((r) => r.stdout.slice(0, 7));
    await Bun.write(
      upstreamJsonPath,
      JSON.stringify(
        {
          upstream_url: upstreamUrl,
          upstream_main_branch: "main",
          upstream_remote: remoteName,
          last_known_upstream_sha: upstreamSha,
          last_synced_at: new Date().toISOString(),
          schedule: "on-upstream-release",
        },
        null,
        2,
      ) + "\n",
    );
  }

  const manifestPath = join(repoDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    await Bun.write(
      manifestPath,
      JSON.stringify(
        {
          target_repo: targetRepo,
          upstream_main_branch: "main",
          upstream_remote: remoteName,
          schedule: "on-upstream-release",
          token_budget_per_run: 100000,
          on_budget_exceed: "pause",
          patches: {},
          apply_order: [],
          slug_aliases: {},
        },
        null,
        2,
      ) + "\n",
    );
  }

  const readmePath = join(relayPatchDir, "README.md");
  if (!existsSync(readmePath)) {
    await Bun.write(readmePath, `# .relay-patch\n\nPatch intents managed by [relay-patch](https://github.com/ImBIos/relay-patch).\n`);
  }

  return {
    targetRepo,
    relayPatchDir,
    upstreamRemote: remoteName,
    upstreamUrl,
    created,
  };
}

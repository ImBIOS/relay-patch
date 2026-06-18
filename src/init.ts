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
  forkRemote?: string;
  target?: string;
};

export type InitResult = {
  targetRepo: string;
  relayPatchDir: string;
  upstreamRemote: string;
  upstreamUrl: string;
  forkRemote: string | null;
  forkUrl: string | null;
  isFork: boolean;
  created: boolean;
};

function parseRemoteUrl(url: string): string | null {
  let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  match = url.match(/^file:\/\/\/(.+?)(?:\.git)?$/);
  if (match) return `local/${match[1]}`;
  return null;
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run `relay-patch init` from inside your fork's checkout.");
  }

  const upstreamRemoteName = options.upstreamRemote ?? "upstream";
  const forkRemoteName = options.forkRemote ?? "origin";
  const remotes = await listRemotes();

  let upstreamRemote: string | null = null;
  let forkRemote: string | null = null;

  if (remotes.includes(upstreamRemoteName)) {
    upstreamRemote = upstreamRemoteName;
  }
  if (remotes.includes(forkRemoteName)) {
    forkRemote = forkRemoteName;
  }

  if (!upstreamRemote && !forkRemote) {
    throw new Error(
      `No git remote named '${upstreamRemoteName}' or '${forkRemoteName}'.\n` +
        `Set up an upstream remote (e.g. 'git remote add upstream <original>') and/or origin (your fork).`,
    );
  }

  if (upstreamRemote && forkRemote) {
    const upstreamUrl = await getRemoteUrl(upstreamRemote);
    const forkUrl = await getRemoteUrl(forkRemote);
    if (upstreamUrl === forkUrl) {
      upstreamRemote = null;
    }
  }

  const isFork = upstreamRemote !== null && forkRemote !== null;

  const trackingRemote = upstreamRemote ?? forkRemote!;
  const trackingUrl = await getRemoteUrl(trackingRemote);
  if (!trackingUrl) {
    throw new Error(`Could not get URL for remote '${trackingRemote}'.`);
  }

  const targetRepo = options.target ?? parseRemoteUrl(trackingUrl);
  if (!targetRepo) {
    throw new Error(
      `Could not parse remote URL: ${trackingUrl}\n` +
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
    const trackingSha = await gitExec(["rev-parse", "HEAD"]).then((r) => r.stdout.slice(0, 7));
    await Bun.write(
      upstreamJsonPath,
      JSON.stringify(
        {
          upstream_url: trackingUrl,
          upstream_main_branch: "main",
          upstream_remote: trackingRemote,
          fork_url: isFork ? await getRemoteUrl(forkRemote!) : null,
          fork_remote: isFork ? forkRemote : null,
          last_known_upstream_sha: trackingSha,
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
          upstream_remote: trackingRemote,
          fork_remote: isFork ? forkRemote : null,
          is_fork: isFork,
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
    const forkNote = isFork
      ? `\n\nThis is a FORK of ${targetRepo}. The 'upstream' remote tracks the original; the 'origin' remote is your fork. Use \`relay-patch pr\` to push draft branches and open PRs back to upstream.\n`
      : "";
    await Bun.write(
      readmePath,
      `# .relay-patch\n\nPatch intents managed by [relay-patch](https://github.com/ImBIos/relay-patch) for ${targetRepo}.${forkNote}\n`,
    );
  }

  return {
    targetRepo,
    relayPatchDir,
    upstreamRemote: trackingRemote,
    upstreamUrl: trackingUrl,
    forkRemote: isFork ? forkRemote : null,
    forkUrl: isFork ? await getRemoteUrl(forkRemote!) : null,
    isFork,
    created,
  };
}

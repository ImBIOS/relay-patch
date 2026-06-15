export type UpdateOptions = {
  tag?: string;
  dryRun?: boolean;
  skipInstall?: boolean;
};

export type UpdateResult = {
  from: string;
  to: string;
  toSha: string;
  stashed: boolean;
  stashRestored: boolean;
  skipped: boolean;
};

export type TagInfo = {
  name: string;
  sha: string;
};

async function git(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: process.cwd(),
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

async function gitOrThrow(args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export async function isGitRepo(): Promise<boolean> {
  const result = await git(["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0 && result.stdout === "true";
}

export async function isDirty(): Promise<boolean> {
  const status = await gitOrThrow(["status", "--porcelain"]);
  return status.length > 0;
}

export async function currentSha(): Promise<string> {
  return await gitOrThrow(["rev-parse", "HEAD"]);
}

export async function currentTag(): Promise<string | null> {
  const result = await git(["describe", "--tags", "--exact-match"]);
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

export async function fetchTags(): Promise<void> {
  await gitOrThrow(["fetch", "--tags", "--quiet"]);
}

export async function listTags(pattern = "v*-rp*"): Promise<TagInfo[]> {
  const tagNames = await gitOrThrow(["tag", "--list", pattern, "--sort=-v:refname"]);
  if (!tagNames) return [];
  const names = tagNames.split("\n").filter(Boolean);
  const infos: TagInfo[] = [];
  for (const name of names) {
    const sha = await gitOrThrow(["rev-list", "-n1", name]);
    infos.push({ name, sha });
  }
  return infos;
}

export async function stash(message: string): Promise<boolean> {
  if (!(await isDirty())) return false;
  await gitOrThrow(["stash", "push", "-u", "-m", message]);
  return true;
}

export async function stashPop(): Promise<boolean> {
  const result = await git(["stash", "pop"]);
  return result.exitCode === 0;
}

export async function checkout(ref: string): Promise<void> {
  await gitOrThrow(["checkout", "--quiet", ref]);
}

export async function install(): Promise<void> {
  const proc = Bun.spawn(["bun", "install", "--silent"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    throw new Error(`bun install failed: ${stderr || stdout}`);
  }
}

export async function runUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run `relay-patch update` from inside your fork's checkout.");
  }

  await fetchTags();

  let targetTag: string | undefined = options.tag;
  if (!targetTag) {
    const tags = await listTags();
    if (tags.length === 0) {
      throw new Error("No relay-patch tags found (looking for v*-rp*). Run a re-derivation first.");
    }
    const latest = tags[0];
    if (!latest) {
      throw new Error("No relay-patch tags found (looking for v*-rp*). Run a re-derivation first.");
    }
    targetTag = latest.name;
  }

  const from = await currentSha();
  const targetSha = await gitOrThrow(["rev-list", "-n1", targetTag]);

  if (from === targetSha) {
    return { from, to: targetTag, toSha: targetSha, stashed: false, stashRestored: false, skipped: true };
  }

  if (options.dryRun) {
    return { from, to: targetTag, toSha: targetSha, stashed: false, stashRestored: false, skipped: false };
  }

  const stashed = await stash("relay-patch: pre-update");

  try {
    await checkout(targetTag);
  } catch (err) {
    if (stashed) {
      await stashPop();
    }
    throw err;
  }

  if (!options.skipInstall) {
    try {
      await install();
    } catch (err) {
      if (stashed) {
        await stashPop();
      }
      throw err;
    }
  }

  let stashRestored = false;
  if (stashed) {
    stashRestored = await stashPop();
  }

  return { from, to: targetTag, toSha: targetSha, stashed, stashRestored, skipped: false };
}

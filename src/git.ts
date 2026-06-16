export type GitResult = { stdout: string; stderr: string; exitCode: number };

export async function gitExec(args: string[], cwd: string = process.cwd()): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
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

export async function gitOrThrow(args: string[], cwd: string = process.cwd()): Promise<string> {
  const result = await gitExec(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export async function isGitRepo(cwd: string = process.cwd()): Promise<boolean> {
  const result = await gitExec(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.exitCode === 0 && result.stdout === "true";
}

export async function currentSha(cwd: string = process.cwd()): Promise<string> {
  return await gitOrThrow(["rev-parse", "HEAD"], cwd);
}

export async function currentBranch(cwd: string = process.cwd()): Promise<string> {
  return await gitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export async function currentTag(cwd: string = process.cwd()): Promise<string | null> {
  const result = await gitExec(["describe", "--tags", "--exact-match"], cwd);
  return result.exitCode === 0 ? result.stdout : null;
}

export async function isDirty(cwd: string = process.cwd()): Promise<boolean> {
  const status = await gitOrThrow(["status", "--porcelain"], cwd);
  return status.length > 0;
}

export async function getRemoteUrl(name: string, cwd: string = process.cwd()): Promise<string | null> {
  const result = await gitExec(["remote", "get-url", name], cwd);
  return result.exitCode === 0 ? result.stdout : null;
}

export async function listRemotes(cwd: string = process.cwd()): Promise<string[]> {
  const result = await gitExec(["remote"], cwd);
  return result.exitCode === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

export async function fetchRemote(remote: string, cwd: string = process.cwd()): Promise<void> {
  await gitOrThrow(["fetch", remote, "--tags", "--quiet"], cwd);
}

export async function checkout(ref: string, cwd: string = process.cwd()): Promise<void> {
  await gitOrThrow(["checkout", "--quiet", ref], cwd);
}

export async function createBranch(name: string, base: string, cwd: string = process.cwd()): Promise<void> {
  await gitOrThrow(["checkout", "-b", name, base], cwd);
}

export async function cherryPick(ref: string, cwd: string = process.cwd()): Promise<void> {
  await gitOrThrow(["cherry-pick", "--allow-empty", ref], cwd);
}

export async function stash(message: string, cwd: string = process.cwd()): Promise<boolean> {
  if (!(await isDirty(cwd))) return false;
  await gitOrThrow(["stash", "push", "-u", "-m", message], cwd);
  return true;
}

export async function stashPop(cwd: string = process.cwd()): Promise<boolean> {
  const result = await gitExec(["stash", "pop"], cwd);
  return result.exitCode === 0;
}

export async function listTags(pattern = "v*-rp*", cwd: string = process.cwd()): Promise<{ name: string; sha: string }[]> {
  const tagNames = await gitOrThrow(["tag", "--list", pattern, "--sort=-v:refname"], cwd);
  if (!tagNames) return [];
  const names = tagNames.split("\n").filter(Boolean);
  const infos: { name: string; sha: string }[] = [];
  for (const name of names) {
    const sha = await gitOrThrow(["rev-list", "-n1", name], cwd);
    infos.push({ name, sha });
  }
  return infos;
}

export async function diff(from: string, to: string, cwd: string = process.cwd(), ...extraArgs: string[]): Promise<string> {
  return await gitOrThrow(["diff", `${from}..${to}`, ...extraArgs], cwd);
}

export async function diffNameOnly(from: string, to: string, cwd: string = process.cwd(), ...extraArgs: string[]): Promise<string[]> {
  const result = await gitOrThrow(["diff", "--name-only", `${from}..${to}`, ...extraArgs], cwd);
  return result ? result.split("\n").filter(Boolean) : [];
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

import { existsSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitOrThrow, gitExec } from "./git";

export type PublishOptions = {
  relayPatchDir?: string;
  message?: string;
};

export type PublishResult = {
  pushed: boolean;
  remote: string;
  commitSha: string;
  commitMessage: string;
  filesStaged: number;
};

export async function runPublish(options: PublishOptions = {}): Promise<PublishResult> {
  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (!existsSync(relayPatchDir)) {
    throw new Error(".relay-patch repo not found. Run `relay-patch init` first.");
  }

  // Check that it's a git repo
  const isRepo = await isGitRepo(relayPatchDir);
  if (!isRepo) {
    throw new Error(
      `${relayPatchDir} is not a git repo. Initialize it with: cd ${relayPatchDir} && git init && git remote add origin <your-github-repo>`,
    );
  }

  // Check remote exists
  const remoteResult = await gitExec(["remote", "get-url", "origin"], relayPatchDir);
  if (remoteResult.exitCode !== 0) {
    throw new Error(
      "No 'origin' remote set on .relay-patch repo. Add one:\n" +
        `  cd ${relayPatchDir}\n` +
        "  git remote add origin git@github.com:USERNAME/.relay-patch.git",
    );
  }
  const remote = remoteResult.stdout;

  // Stage all patch files
  await gitOrThrow(["add", "-A"], relayPatchDir);

  // Check if there's anything to commit
  const statusResult = await gitExec(["status", "--porcelain", "--untracked-files=no"], relayPatchDir);
  const stagedFiles = statusResult.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .filter((l) => l.startsWith("A") || l.startsWith("M") || l.startsWith("D"));

  if (stagedFiles.length === 0) {
    // Nothing to publish
    const shaResult = await gitExec(["rev-parse", "HEAD"], relayPatchDir);
    return {
      pushed: false,
      remote,
      commitSha: shaResult.stdout.slice(0, 7),
      commitMessage: "(no changes)",
      filesStaged: 0,
    };
  }

  // Commit
  const message =
    options.message ??
    `chore: sync patches (${new Date().toISOString().split("T")[0]})`;
  await gitOrThrow(["commit", "-m", message, "--allow-empty=false"], relayPatchDir);

  // Push
  const branchResult = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], relayPatchDir);
  const branch = branchResult.stdout || "main";
  const pushResult = await gitExec(["push", "origin", branch], relayPatchDir);
  if (pushResult.exitCode !== 0) {
    throw new Error(
      `git push failed: ${pushResult.stderr || pushResult.stdout}\n` +
        `The commit was made but not pushed. Check your remote and branch.\n` +
        `Remote: ${remote}\nBranch: ${branch}`,
    );
  }

  const shaResult = await gitExec(["rev-parse", "HEAD"], relayPatchDir);

  return {
    pushed: true,
    remote,
    commitSha: shaResult.stdout.slice(0, 7),
    commitMessage: message,
    filesStaged: stagedFiles.length,
  };
}

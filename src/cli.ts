import { runUpdate, type UpdateOptions } from "./update";
import { runRollback } from "./rollback";

const HELP = `relay-patch — keep up-to-date upstream + your custom patches

Usage:
  relay-patch update [--tag <tag>] [--dry-run] [--skip-install]
                                    Update to latest (or specified) tag
  relay-patch rollback              Roll back to the previous tag
  relay-patch status                Show current state
  relay-patch --help                Show this help

Run from within your fork's checkout directory. Tags should follow the
\`v<upstream>-rp<build>\` convention (e.g., v2.1.0-rp1).
`;

function parseArgs(argv: string[]): { command?: string; opts: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg && arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return { command, opts };
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

async function runStatus() {
  const { isGitRepo, currentSha, currentTag, listTags } = await import("./update");
  if (!(await isGitRepo())) {
    console.error("Not a git repository.");
    process.exit(1);
  }
  const sha = await currentSha();
  const tag = await currentTag();
  const tags = await listTags();

  console.log(`Current:  ${tag ?? "(detached)"} ${shortSha(sha)}`);
  const latest = tags[0];
  if (latest) {
    console.log(`Latest:   ${latest.name} ${shortSha(latest.sha)}`);
    if (latest.sha !== sha) {
      console.log(`\nRun \`relay-patch update\` to advance.`);
    } else {
      console.log(`\nAlready at latest.`);
    }
  } else {
    console.log(`\nNo relay-patch tags found.`);
  }
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  try {
    switch (command) {
      case "update": {
        const updateOpts: UpdateOptions = {};
        if (typeof opts.tag === "string") updateOpts.tag = opts.tag;
        if (opts["dry-run"] === true) updateOpts.dryRun = true;
        if (opts["skip-install"] === true) updateOpts.skipInstall = true;

        const result = await runUpdate(updateOpts);

        if (result.skipped) {
          console.log(`Already at ${result.to} (${shortSha(result.from)}). Nothing to do.`);
          return;
        }

        if (opts["dry-run"]) {
          console.log(`[dry-run] Would update ${shortSha(result.from)} → ${result.to} (${shortSha(result.toSha)})`);
          return;
        }

        console.log(`Updated ${shortSha(result.from)} → ${result.to} (${shortSha(result.toSha)})`);
        if (result.stashed) {
          if (result.stashRestored) {
            console.log(`Local changes restored from stash.`);
          } else {
            console.warn(`Local changes could not be restored (conflicts). See \`git stash list\`.`);
          }
        }
        break;
      }

      case "rollback": {
        const rollbackOpts: UpdateOptions = {};
        if (opts["dry-run"] === true) rollbackOpts.dryRun = true;
        if (opts["skip-install"] === true) rollbackOpts.skipInstall = true;

        const result = await runRollback(rollbackOpts);
        if (result.skipped) {
          console.log(`Already at ${result.to}. Nothing to do.`);
        } else {
          console.log(`Rolled back ${result.from} → ${result.to} (${shortSha(result.toSha)})`);
        }
        break;
      }

      case "status": {
        await runStatus();
        break;
      }

      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();

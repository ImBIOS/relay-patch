import { runUpdate, type UpdateOptions } from "./update";
import { runRollback } from "./rollback";
import { runInit } from "./init";
import { runDraft } from "./draft";
import { runSatisfied } from "./satisfied";

const HELP = `relay-patch — keep up-to-date upstream + your custom patches

Usage:
  relay-patch init [--upstream-remote <name>]   Set up .relay-patch repo
  relay-patch draft "<intent>"                  Create a draft branch for a new patch
  relay-patch satisfied [--skip-port]           Finalize intent, port to relay-patch/main
  relay-patch update [--tag <tag>] [--dry-run]  Update to latest (or specified) tag
  relay-patch rollback                          Roll back to the previous tag
  relay-patch status                            Show current state
  relay-patch --help                            Show this help

Producer commands (init, draft, satisfied) run from inside your fork's checkout.
Consumer commands (update, rollback, status) also run from the fork checkout.
`;

function parseArgs(argv: string[]): { command?: string; opts: Record<string, string | boolean>; positional: string[] } {
  const [command, ...rest] = argv;
  const opts: Record<string, string | boolean> = {};
  const positional: string[] = [];
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
    } else if (arg) {
      positional.push(arg);
    }
  }
  return { command, opts, positional };
}

async function runStatus() {
  const { isGitRepo, currentSha, currentTag, listTags } = await import("./git");
  if (!(await isGitRepo())) {
    console.error("Not a git repository.");
    process.exit(1);
  }
  const sha = await currentSha();
  const tag = await currentTag();
  const tags = await listTags();

  console.log(`Current:  ${tag ?? "(detached)"} ${sha.slice(0, 7)}`);
  const latest = tags[0];
  if (latest) {
    console.log(`Latest:   ${latest.name} ${latest.sha.slice(0, 7)}`);
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
  const { command, opts, positional } = parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  try {
    switch (command) {
      case "init": {
        const initOpts: { upstreamRemote?: string; target?: string } = {};
        if (typeof opts["upstream-remote"] === "string") initOpts.upstreamRemote = opts["upstream-remote"];
        if (typeof opts.target === "string") initOpts.target = opts.target;

        const result = await runInit(initOpts);
        console.log(`Target repo:     ${result.targetRepo}`);
        console.log(`Upstream remote: ${result.upstreamRemote} (${result.upstreamUrl})`);
        console.log(`.relay-patch:    ${result.relayPatchDir}`);
        console.log(result.created ? "Created new .relay-patch repo." : "Existing .relay-patch repo configured.");
        break;
      }

      case "draft": {
        const intent = positional.join(" ");
        if (!intent) {
          throw new Error("Intent description required. Usage: relay-patch draft \"<intent>\"");
        }
        const result = await runDraft(intent);
        console.log(`Branch:    ${result.branch}`);
        console.log(`Slug:      ${result.slug}`);
        console.log(`Base:      ${result.baseSha.slice(0, 7)}`);
        console.log(`Draft:     ${result.draftFile}`);
        console.log(`\nImplement your patch on branch '${result.branch}'.`);
        console.log(`When done, run: relay-patch satisfied`);
        break;
      }

      case "satisfied": {
        const satisfiedOpts: { skipPort?: boolean } = {};
        if (opts["skip-port"] === true) satisfiedOpts.skipPort = true;

        const result = await runSatisfied(satisfiedOpts);
        console.log(`Patch ID:       ${result.patchId}`);
        console.log(`Branch:         ${result.branch}`);
        console.log(`Files changed:  ${result.filesChanged.join(", ") || "(none)"}`);
        if (result.relayPatchMainUpdated) {
          console.log(`Ported to:      relay-patch/main`);
          if (result.tag) console.log(`Tag:            ${result.tag}`);
        } else {
          console.log(`Port:           skipped`);
        }
        console.log(`\nIntent saved to .relay-patch.`);
        break;
      }

      case "update": {
        const updateOpts: UpdateOptions = {};
        if (typeof opts.tag === "string") updateOpts.tag = opts.tag;
        if (opts["dry-run"] === true) updateOpts.dryRun = true;
        if (opts["skip-install"] === true) updateOpts.skipInstall = true;

        const result = await runUpdate(updateOpts);

        if (result.skipped) {
          console.log(`Already at ${result.to} (${result.from.slice(0, 7)}). Nothing to do.`);
          return;
        }

        if (opts["dry-run"]) {
          console.log(`[dry-run] Would update ${result.from.slice(0, 7)} → ${result.to} (${result.toSha.slice(0, 7)})`);
          return;
        }

        console.log(`Updated ${result.from.slice(0, 7)} → ${result.to} (${result.toSha.slice(0, 7)})`);
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
          console.log(`Rolled back ${result.from} → ${result.to} (${result.toSha.slice(0, 7)})`);
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

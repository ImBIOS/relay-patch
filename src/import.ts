import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { isGitRepo } from "./git";
import { generateULID8 } from "./patch-id";

export type ImportOptions = {
  relayPatchDir?: string;
  force?: boolean;
};

export type ImportResult = {
  patchId: string;
  targetRepo: string;
  author: string;
  filesImported: string[];
  rederivationNeeded: boolean;
};

type IntentFrontmatter = {
  id?: string;
  title?: string;
  target_repo?: string;
  target_area?: string[];
  author?: string;
  license?: string;
  version?: string;
};

function parseFrontmatter(content: string): { data: IntentFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1]) return { data: {}, body: content };
  const yamlText = match[1];
  const body = match[2] ?? content;
  const data: IntentFrontmatter = {};
  for (const line of yamlText.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m?.[1] || !m[2]) continue;
    const key = m[1];
    const value = m[2];
    if (key === "target_area") {
      const arrMatch = value.match(/\[(.+?)\]/);
      if (arrMatch?.[1]) {
        data.target_area = arrMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
      }
    } else {
      (data as Record<string, unknown>)[key] = value.replace(/["']/g, "");
    }
  }
  return { data, body };
}

function blobUrlToRaw(url: string): string {
  return url
    .replace("github.com", "raw.githubusercontent.com")
    .replace("/blob/", "/");
}

function parseImportSource(source: string): { user: string; repo: string; branch: string; path: string } | null {
  let match = source.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (match?.[1] && match[2] && match[3] && match[4]) {
    return { user: match[1], repo: match[2], branch: match[3], path: match[4] };
  }
  return null;
}

async function fetchRawFile(rawUrl: string): Promise<string | null> {
  try {
    const response = await fetch(rawUrl);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchPatchFiles(
  user: string,
  branch: string,
  patchPath: string,
): Promise<{ intent: string; acceptance: string | null; reference: string | null; attempts: string | null }> {
  const baseUrl = `https://raw.githubusercontent.com/${user}/.relay-patch/${branch}/${patchPath}`;

  const intent = await fetchRawFile(`${baseUrl}/INTENT.md`);
  if (!intent) {
    throw new Error(`Could not fetch INTENT.md from ${baseUrl}/INTENT.md`);
  }

  const acceptance = await fetchRawFile(`${baseUrl}/ACCEPTANCE.md`);
  const reference = await fetchRawFile(`${baseUrl}/reference.diff`);
  const attempts = await fetchRawFile(`${baseUrl}/attempts.jsonl`);

  return { intent, acceptance, reference, attempts };
}

export async function runImport(source: string, options: ImportOptions = {}): Promise<ImportResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const relayPatchDir = options.relayPatchDir ?? join(process.cwd(), "..", ".relay-patch");
  if (!existsSync(relayPatchDir)) {
    throw new Error(".relay-patch repo not found. Run `relay-patch init` first.");
  }

  let parsed = parseImportSource(source);
  let patchPath: string;

  if (parsed && parsed.path !== "repos") {
    patchPath = parsed.path.replace(/\/INTENT\.md$/, "");
  } else if (parsed && parsed.user) {
    throw new Error(
      `Shorthand @user/patch-id requires knowing the target repo.\n` +
      `Use the full URL:\n` +
      `  relay-patch import https://github.com/${parsed.user}/.relay-patch/blob/main/repos/<host>/<owner>/<repo>/patches/<patch-id>/INTENT.md`,
    );
  } else {
    throw new Error(
      `Could not parse import source: ${source}\n` +
      `Use a GitHub URL to INTENT.md or a patch directory.`,
    );
  }

  const branch = parsed?.branch ?? "main";
  const user = parsed?.user ?? "";

  const { intent, acceptance, reference, attempts } = await fetchPatchFiles(user, branch, patchPath);
  const { data: frontmatter } = parseFrontmatter(intent);

  const patchId = frontmatter.id ?? `imported-${generateULID8()}`;
  const targetRepo = frontmatter.target_repo;
  if (!targetRepo) {
    throw new Error("Imported INTENT.md has no target_repo in frontmatter.");
  }

  const author = frontmatter.author ?? user;

  const repoDir = join(relayPatchDir, "repos", targetRepo);
  if (!existsSync(repoDir)) {
    mkdirSync(repoDir, { recursive: true });
    await Bun.write(
      join(repoDir, "manifest.json"),
      JSON.stringify(
        {
          target_repo: targetRepo,
          upstream_main_branch: "main",
          upstream_remote: "upstream",
          schedule: "on-upstream-release",
          patches: {},
          apply_order: [],
          slug_aliases: {},
        },
        null,
        2,
      ) + "\n",
    );
  }

  const patchDir = join(repoDir, "patches", patchId);
  if (existsSync(patchDir) && !options.force) {
    throw new Error(
      `Patch ${patchId} already exists. Use --force to overwrite.`,
    );
  }

  mkdirSync(patchDir, { recursive: true });

  const filesImported: string[] = [];

  const intentContent = intent.replace(
    /^(source_url:) null$/m,
    `source_url: https://github.com/${user}/.relay-patch/blob/${branch}/${patchPath}/INTENT.md`,
  ).replace(
    /^(imported_at:) null$/m,
    `imported_at: ${new Date().toISOString()}`,
  );

  await Bun.write(join(patchDir, "INTENT.md"), intentContent);
  filesImported.push("INTENT.md");

  if (acceptance) {
    await Bun.write(join(patchDir, "ACCEPTANCE.md"), acceptance);
    filesImported.push("ACCEPTANCE.md");
  }

  if (reference) {
    await Bun.write(join(patchDir, "reference.diff"), reference);
    filesImported.push("reference.diff");
  }

  if (attempts) {
    await Bun.write(join(patchDir, "attempts.jsonl"), attempts);
    filesImported.push("attempts.jsonl");
  }

  const manifestPath = join(repoDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.patches[patchId] = {
    status: "imported",
    version: parseInt(frontmatter.version ?? "1"),
    author,
    last_modified_by: author,
    last_realized_against_commit: null,
  };
  if (!manifest.apply_order.includes(patchId)) {
    manifest.apply_order.push(patchId);
  }
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return {
    patchId,
    targetRepo,
    author,
    filesImported,
    rederivationNeeded: true,
  };
}

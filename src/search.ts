export type SearchResult = {
  user: string;
  repo: string;
  branch: string;
  path: string;
  url: string;
  patchId: string;
  title: string;
  targetRepo: string | null;
};

export type SearchOptions = {
  targetRepo?: string;
  author?: string;
  query?: string;
  limit?: number;
};

type GitHubCodeResult = {
  total_count: number;
  items: Array<{
    name: string;
    path: string;
    html_url: string;
    repository: { full_name: string; default_branch: string };
  }>;
};

async function githubApi(path: string): Promise<any> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    if (response.status === 403) {
      const body = await response.text();
      throw new Error(`GitHub API rate limited. ${body.slice(0, 200)}`);
    }
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function fetchIntentMeta(user: string, repo: string, branch: string, path: string): Promise<{ patchId: string; title: string; targetRepo: string | null }> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
    const response = await fetch(rawUrl);
    if (!response.ok) return { patchId: path.split("/").pop()?.replace("/INTENT.md", "") ?? "unknown", title: "unknown", targetRepo: null };
    const content = await response.text();
    const idMatch = content.match(/^id:\s*(.+)$/m);
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const targetMatch = content.match(/^target_repo:\s*(.+)$/m);
    return {
      patchId: idMatch?.[1]?.trim() ?? path.split("/").pop()?.replace("/INTENT.md", "") ?? "unknown",
      title: titleMatch?.[1]?.trim() ?? "unknown",
      targetRepo: targetMatch?.[1]?.trim() ?? null,
    };
  } catch {
    return { patchId: "unknown", title: "unknown", targetRepo: null };
  }
}

export async function runSearch(options: SearchOptions = {}): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;

  if (options.author) {
    return await searchByAuthor(options.author, options);
  }

  if (options.targetRepo) {
    return await searchByTargetRepo(options.targetRepo, options);
  }

  throw new Error(
    "Search requires --author <username> or --target <github.com/owner/repo>.\n" +
    "GitHub code search API requires authentication for unfiltered queries.\n" +
    "Example: relay-patch search --author alice\n" +
    "         relay-patch search --target github.com/owner/repo",
  );
}

async function searchByAuthor(author: string, options: SearchOptions): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;
  const candidates: Array<{ user: string; repo: string; branch: string; path: string; url: string }> = [];

  const dotRepoUrl = `https://api.github.com/repos/${author}/.relay-patch/git/trees/main?recursive=1`;
  try {
    const tree: any = await githubApi(dotRepoUrl);
    if (tree.truncated || !tree.tree) {
      throw new Error("Tree too large or empty");
    }
    for (const entry of tree.tree) {
      if (entry.type === "blob" && entry.path.includes("/patches/") && entry.path.endsWith("/INTENT.md")) {
        candidates.push({
          user: author,
          repo: ".relay-patch",
          branch: "main",
          path: entry.path,
          url: `https://github.com/${author}/.relay-patch/blob/main/${entry.path}`,
        });
      }
    }
  } catch {
    const reposData: any = await githubApi(`/users/${author}/repos?per_page=100`);
    for (const r of reposData.filter((r: any) => r.name === ".relay-patch")) {
      try {
        const tree: any = await githubApi(`/repos/${author}/.relay-patch/git/trees/${r.default_branch}?recursive=1`);
        for (const entry of tree.tree) {
          if (entry.type === "blob" && entry.path.includes("/patches/") && entry.path.endsWith("/INTENT.md")) {
            candidates.push({
              user: author,
              repo: ".relay-patch",
              branch: r.default_branch,
              path: entry.path,
              url: `https://github.com/${author}/.relay-patch/blob/${r.default_branch}/${entry.path}`,
            });
          }
        }
      } catch {}
    }
  }

  return await filterAndEnrich(candidates, options, limit);
}

async function searchByTargetRepo(targetRepo: string, options: SearchOptions): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;
  const dotRepoSearch: any = await githubApi(
    `/search/repositories?q=${encodeURIComponent(targetRepo + " in:name .relay-patch")}&per_page=20`,
  );
  const candidates: Array<{ user: string; repo: string; branch: string; path: string; url: string }> = [];
  for (const r of dotRepoSearch.items ?? []) {
    try {
      const tree: any = await githubApi(
        `/repos/${r.full_name}/git/trees/${r.default_branch}?recursive=1`,
      );
      for (const entry of tree.tree) {
        if (entry.type === "blob" && entry.path.includes("/patches/") && entry.path.endsWith("/INTENT.md")) {
          const [user, repo] = r.full_name.split("/");
          candidates.push({
            user,
            repo,
            branch: r.default_branch,
            path: entry.path,
            url: `https://github.com/${r.full_name}/blob/${r.default_branch}/${entry.path}`,
          });
        }
      }
    } catch {}
  }
  return await filterAndEnrich(candidates, options, limit);
}

async function filterAndEnrich(
  candidates: Array<{ user: string; repo: string; branch: string; path: string; url: string }>,
  options: SearchOptions,
  limit: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const c of candidates) {
    const meta = await fetchIntentMeta(c.user, c.repo, c.branch, c.path);
    if (options.targetRepo && meta.targetRepo !== options.targetRepo) continue;
    if (options.query) {
      const q = options.query.toLowerCase();
      if (!meta.title.toLowerCase().includes(q) && !meta.patchId.toLowerCase().includes(q)) continue;
    }
    results.push({ ...c, ...meta });
    if (results.length >= limit) break;
  }
  return results;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No patches found.\n";
  }
  const lines: string[] = [`Found ${results.length} patch(es):\n`];
  for (const r of results) {
    lines.push(`  ${r.patchId}`);
    lines.push(`    title:      ${r.title}`);
    lines.push(`    author:     ${r.user}`);
    if (r.targetRepo) lines.push(`    target:     ${r.targetRepo}`);
    lines.push(`    import:     relay-patch import ${r.url}`);
    lines.push("");
  }
  return lines.join("\n");
}

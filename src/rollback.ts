import { currentTag, listTags, runUpdate, type UpdateOptions } from "./update";

export type RollbackResult = {
  from: string;
  to: string;
  toSha: string;
  skipped: boolean;
};

export async function runRollback(options: UpdateOptions = {}): Promise<RollbackResult> {
  const current = await currentTag();
  if (!current) {
    throw new Error("Not currently on a tag. Use `relay-patch update --tag <tag>` instead.");
  }

  const tags = await listTags();
  const idx = tags.findIndex((t) => t.name === current);
  if (idx === -1 || idx === tags.length - 1) {
    throw new Error("No previous tag to roll back to.");
  }

  const previous = tags[idx + 1];
  if (!previous) {
    throw new Error("No previous tag to roll back to.");
  }
  const updateResult = await runUpdate({ ...options, tag: previous.name });

  return {
    from: current,
    to: previous.name,
    toSha: updateResult.toSha,
    skipped: updateResult.skipped,
  };
}

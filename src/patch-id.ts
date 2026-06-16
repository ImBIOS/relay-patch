const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

export function generateULID8(): string {
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  }
  return id;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function generatePatchId(slug: string): string {
  return `${slug}-${generateULID8()}`;
}

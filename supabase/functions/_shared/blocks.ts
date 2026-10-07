// The source-block vocabulary the reporting engine understands, and the
// product each block maps to. MIRRORS productOf() in src/lib/engine-core.js and
// the backfill CASE in schema_v9 -- a test asserts all three stay identical, so
// a change in one that isn't made in the others fails the build, not the data.

export const ALLOWED_BLOCK_PREFIXES = ["GB:", "EB:", "EB_MB:", "SP:", "SP_MB:", "XP:"] as const;

export function isKnownBlock(block: string): boolean {
  return ALLOWED_BLOCK_PREFIXES.some((p) => block.startsWith(p));
}

export function productOfBlock(block: string): string {
  if (block.startsWith("GB:")) return "Globalbet Virtual";
  if (block === "EB:LUCKYBALL") return "Luckyball";
  if (block === "EB:LUCKYGREECK") return "Luckygreek";
  if (block === "EB:ROCKET_MAN") return "Rocket Man";
  if (block === "EB_MB:BASE") return "Luckyball (Monthly)";
  if (block.startsWith("SP_MB:")) return "Sports (Monthly)";
  if (block.startsWith("SP:")) return "Sports";
  if (block.startsWith("XP:")) return "Xpool";
  return "Other";
}

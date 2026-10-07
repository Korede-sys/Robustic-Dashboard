// Deterministic record identity. Sources that give no record id (every file
// export, and likely most report endpoints) are identified by WHAT the record
// is, so syncing the same data twice yields the same key and updates in place
// instead of duplicating. Case-insensitive on the agent, matching how the
// engine merges agents.
export function recordKey(
  sourceId: string, sourceBlock: string, agentUsername: string, periodStart: string, periodEnd: string,
): string {
  return [sourceId, sourceBlock, agentUsername.trim().toLowerCase(), periodStart, periodEnd].join("|");
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

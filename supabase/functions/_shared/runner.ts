import type {
  Connector, ConnectorContext, NormalizedRecord, SyncMode, SyncWindow,
} from "./connector.ts";
import { MissingSecretError } from "./connector.ts";
import { isKnownBlock, productOfBlock } from "./blocks.ts";
import { isIsoDate, recordKey } from "./keys.ts";
import { redact } from "./sanitize.ts";
import { Clock, RateLimiter, makeHttp, realClock } from "./resilience.ts";
import type { ApplyBatchParams, ApplyItem, Store } from "./store.ts";

export interface RunRequest { mode: SyncMode; from?: string; to?: string }
export interface RunDeps {
  connector: Connector;
  store: Store;
  getSecret: (name: string) => string | undefined;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  random?: () => number;
  today?: () => string;
  log?: (m: string) => void;
}
export interface RunResult {
  ok: boolean;
  status: "succeeded" | "partial" | "failed" | "refused";
  runId?: string;
  message: string;
  counts: { seen: number; inserted: number; updated: number; unchanged: number; removed: number; skipped: number };
}

const emptyCounts = () => ({ seen: 0, inserted: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0 });
const refuse = (message: string): RunResult => ({ ok: false, status: "refused", message, counts: emptyCounts() });
const STALE_RUN_MS = 15 * 60 * 1000;

function finite(n: unknown): boolean { return n === null || (typeof n === "number" && Number.isFinite(n)); }

function validate(r: NormalizedRecord): string | null {
  const it = r.item;
  if (!it.agentUsername || !it.agentUsername.trim()) return "missing agent username";
  if (!isKnownBlock(it.sourceBlock)) return `unknown source block "${it.sourceBlock}"`;
  if (!isIsoDate(r.periodStart) || !isIsoDate(r.periodEnd) || r.periodEnd < r.periodStart) return "invalid period";
  for (const k of ["tickets", "stake", "payout", "profit", "commissionAmount", "balance", "moneyWin"] as const) {
    if (!finite(it[k])) return `non-numeric ${k}`;
  }
  if (typeof it.isHouse !== "boolean") return "isHouse must be a boolean";
  return null;
}

// One place that builds what a connector is allowed to use: server-side secrets
// by name (and a record of their values, so any message can be scrubbed), and
// an HTTP client that enforces the connector's rate limit, timeouts and retry
// policy. Used by both Sync and Test Connection so they behave identically.
export function buildContext(
  connector: Connector,
  rawGetSecret: (name: string) => string | undefined,
  o: { clock?: Clock; fetchImpl?: typeof fetch; random?: () => number; log?: (m: string) => void } = {},
): { ctx: ConnectorContext; seenSecrets: string[] } {
  const clock = o.clock ?? realClock;
  const seenSecrets: string[] = [];
  const getSecret = (name: string): string => {
    const v = rawGetSecret(name);
    if (v === undefined || v === "") throw new MissingSecretError(name);
    seenSecrets.push(v);
    return v;
  };
  const rl = connector.rateLimit();
  const log = o.log ?? (() => {});
  return {
    seenSecrets,
    ctx: {
      getSecret, log: (m) => log(redact(m, seenSecrets)),
      http: makeHttp({
        clock, limiter: new RateLimiter(rl.minIntervalMs, clock), maxRetries: rl.maxRetries,
        fetchImpl: o.fetchImpl, random: o.random, timeoutMs: 30_000, secrets: () => seenSecrets,
      }),
    },
  };
}

// Runs one synchronization. The order of the guarantees matters:
//  1. A connector that isn't implemented is REFUSED -- no run row, no "Sync
//     Failed" on a backoffice that never had a connector.
//  2. Only one sync per backoffice at a time.
//  3. Every failure is recorded with a sanitized message; no secret can reach
//     the run history, the response, or a log.
//  4. Data is applied per batch, atomically and idempotently (see
//     schema_v11's sync_apply_batch) and never overwrites a manual upload.
export async function runSync(deps: RunDeps, req: RunRequest): Promise<RunResult> {
  const { connector, store } = deps;
  const clock = deps.clock ?? realClock;
  const log = deps.log ?? (() => {});
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));

  if (connector.status !== "implemented" || !connector.integrationType) {
    return refuse(`${connector.displayName} has no live connector yet. ${connector.assessment.blockers[0] ?? ""}`.trim());
  }
  if (await store.hasRunningRun(connector.id, STALE_RUN_MS)) {
    return refuse(`A sync for ${connector.displayName} is already running.`);
  }

  const since = req.mode === "incremental" ? await store.lastWatermark(connector.id) : null;
  const from = req.from ?? since?.slice(0, 10);
  const to = req.to ?? today();
  if (!from) return refuse("A date window (from/to) is required for a first or full sync.");
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return refuse("Invalid date window.");
  const window: SyncWindow = { from, to, since };

  const { ctx, seenSecrets } = buildContext(connector, deps.getSecret, {
    clock, fetchImpl: deps.fetchImpl, random: deps.random, log,
  });

  const runId = await store.startRun(connector.id, req.mode, since);
  const counts = emptyCounts();
  const warnings: string[] = [];
  try {
    // ---- fetch + normalize -------------------------------------------------
    const records: NormalizedRecord[] = [];
    let normalizeFailures = 0;
    for await (const raw of connector.fetchWindow(ctx, window)) {
      counts.seen++;
      try { records.push(...connector.normalize(raw)); } catch { normalizeFailures++; }
    }
    if (counts.seen > 0 && records.length === 0) {
      throw new Error(`The source returned ${counts.seen} record(s) but none could be read in the expected format. The source format may have changed; nothing was imported.`);
    }
    if (normalizeFailures) { counts.skipped += normalizeFailures; warnings.push(`${normalizeFailures} record(s) could not be normalized`); }

    // ---- validate + de-duplicate --------------------------------------------
    const byBatch = new Map<string, { p: ApplyBatchParams; keys: Set<string> }>();
    let latestTs: string | null = null;
    let invalid = 0, duplicate = 0;
    for (const r of records) {
      const problem = validate(r);
      if (problem) { invalid++; continue; }
      const key = recordKey(connector.id, r.item.sourceBlock, r.item.agentUsername, r.periodStart, r.periodEnd);
      const bk = `${r.batchType}|${r.periodStart}|${r.periodEnd}`;
      let b = byBatch.get(bk);
      if (!b) {
        b = { p: { sourceId: connector.id, batchType: r.batchType, periodStart: r.periodStart, periodEnd: r.periodEnd, integrationType: connector.integrationType, items: [] }, keys: new Set() };
        byBatch.set(bk, b);
      }
      if (b.keys.has(key)) { duplicate++; continue; } // first wins; flagged so it is never silent
      b.keys.add(key);
      const it = r.item;
      const apply: ApplyItem = {
        key, agent_username: it.agentUsername.trim(), source_block: it.sourceBlock, tickets: it.tickets, stake: it.stake,
        payout: it.payout, profit: it.profit, commission_amount: it.commissionAmount, commission_type: it.commissionType,
        balance: it.balance, is_house: it.isHouse, product: productOfBlock(it.sourceBlock), parent_username: it.parentUsername ?? null,
        money_win: it.moneyWin, source_agent_username: it.sourceAgentUsername ?? null,
        source_record_id: r.sourceRecordId, source_timestamp: r.sourceTimestamp,
      };
      b.p.items.push(apply);
      if (r.sourceTimestamp && (!latestTs || r.sourceTimestamp > latestTs)) latestTs = r.sourceTimestamp;
    }
    if (invalid) { counts.skipped += invalid; warnings.push(`${invalid} invalid record(s) skipped`); }
    if (duplicate) { counts.skipped += duplicate; warnings.push(`${duplicate} duplicate record(s) skipped`); }

    // ---- apply (atomic + idempotent per batch) -------------------------------
    for (const { p } of byBatch.values()) {
      const res = await store.applyBatch(runId, p);
      counts.inserted += res.inserted; counts.updated += res.updated;
      counts.unchanged += res.unchanged; counts.removed += res.removed;
      if (res.status !== "applied") {
        counts.skipped += res.items;
        warnings.push(res.status === "skipped_manual_exists"
          ? `${p.periodStart}..${p.periodEnd} (${p.batchType}): a manual/CSV upload already covers this period, so it was left untouched. Delete that upload if the live data should replace it.`
          : `${p.periodStart}..${p.periodEnd} (${p.batchType}): overlaps another batch for this source, so it was not imported.`);
      }
    }

    const status = warnings.length ? "partial" : "succeeded";
    const message = warnings.length ? warnings.join(" ") : "Sync completed.";
    await store.finishRun(runId, {
      status, recordsSeen: counts.seen, recordsInserted: counts.inserted, recordsUpdated: counts.updated,
      recordsSkipped: counts.skipped, watermarkAfter: latestTs ?? `${to}T00:00:00Z`, errorSummary: warnings.length ? redact(message, seenSecrets) : null,
    });
    return { ok: true, status, runId, message: redact(message, seenSecrets), counts };
  } catch (e) {
    const message = redact(e, seenSecrets);
    await store.finishRun(runId, {
      status: "failed", recordsSeen: counts.seen, recordsInserted: counts.inserted, recordsUpdated: counts.updated,
      recordsSkipped: counts.skipped, watermarkAfter: null, errorSummary: message,
    });
    return { ok: false, status: "failed", runId, message, counts };
  }
}

// Verifies the connector framework against a REAL PostgreSQL (PGlite) running the
// ACTUAL migration files (v9, v10, v11) -- not a re-implementation of their logic.
// The connector used here is a clearly-labelled TEST FIXTURE: it stands in for a
// backoffice so the framework can be exercised; it is never registered, shipped,
// or presented as an integration. No real backoffice is contacted by any test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Connector, NormalizedRecord, RawRecord } from "../supabase/functions/_shared/connector.ts";
import { MissingSecretError } from "../supabase/functions/_shared/connector.ts";
import { runSync, buildContext } from "../supabase/functions/_shared/runner.ts";
import type { ApplyBatchParams, ApplyResult, RunFinish, Store } from "../supabase/functions/_shared/store.ts";
import { redact } from "../supabase/functions/_shared/sanitize.ts";
import { recordKey } from "../supabase/functions/_shared/keys.ts";
import { productOfBlock } from "../supabase/functions/_shared/blocks.ts";
import { CONNECTORS, describeConnectors } from "../supabase/functions/_shared/registry.ts";
import type { Clock } from "../supabase/functions/_shared/resilience.ts";
// @ts-ignore -- plain JS module shared with the dashboard
import { liveConnectionStatus } from "../src/lib/sources.js";
// @ts-ignore
import { productOf } from "../src/lib/engine-core.js";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");

// ---------- real Postgres with the real migrations ----------
async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create table profiles (id uuid primary key default gen_random_uuid());
    create function get_my_role() returns text language sql as $$ select 'admin'::text $$;
  `);
  const base = read("schema.sql");
  const ddl = (base.match(/create table (?:batches|line_items) \([\s\S]*?\n\);/g) ?? []).join("\n");
  assert.ok(ddl.includes("create table batches") && ddl.includes("create table line_items"), "base DDL found");
  await db.exec(ddl);
  for (const f of ["schema_v9_data_sources.sql", "schema_v10_xpool.sql", "schema_v11_sync_infrastructure.sql"]) await db.exec(read(f));
  return db;
}

class PgStore implements Store {
  constructor(public db: PGlite) {}
  async hasRunningRun(id: string, staleMs: number) {
    const r = await this.db.query(`select 1 from sync_runs where source_id=$1 and via='connector' and status='running' and started_at > now() - ($2 || ' milliseconds')::interval`, [id, String(staleMs)]);
    return r.rows.length > 0;
  }
  async lastWatermark(id: string) {
    const r = await this.db.query<{ w: string }>(`select watermark_after::text as w from sync_runs where source_id=$1 and via='connector' and status in ('succeeded','partial') and watermark_after is not null order by started_at desc, id limit 1`, [id]);
    return r.rows[0]?.w ?? null;
  }
  async startRun(id: string, mode: string, wb: string | null) {
    const r = await this.db.query<{ id: string }>(`insert into sync_runs (source_id, mode, status, via, watermark_before) values ($1,$2,'running','connector',$3) returning id`, [id, mode, wb]);
    return r.rows[0].id;
  }
  async finishRun(runId: string, x: RunFinish) {
    await this.db.query(`update sync_runs set status=$2, finished_at=now(), records_seen=$3, records_inserted=$4, records_updated=$5, records_skipped=$6, watermark_after=$7, error_summary=$8 where id=$1`,
      [runId, x.status, x.recordsSeen, x.recordsInserted, x.recordsUpdated, x.recordsSkipped, x.watermarkAfter, x.errorSummary]);
  }
  async applyBatch(runId: string, p: ApplyBatchParams): Promise<ApplyResult> {
    const r = await this.db.query<{ r: any }>(`select sync_apply_batch($1,$2,$3::date,$4::date,$5,$6::jsonb,$7::uuid) as r`,
      [p.sourceId, p.batchType, p.periodStart, p.periodEnd, p.integrationType, JSON.stringify(p.items), runId]);
    const d = r.rows[0].r;
    return { status: d.status, batchId: d.batch_id, items: d.items, inserted: d.inserted, updated: d.updated, unchanged: d.unchanged, removed: d.removed };
  }
}

// ---------- fake clock + fixture backoffice ----------
function fakeClock() {
  let t = 1_000_000; const sleeps: number[] = []; const calls: number[] = [];
  const clock: Clock = { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
  return { clock, sleeps, calls, tick: (ms: number) => { t += ms; }, now: () => t };
}
type Row = { agent: string; stake: number | null; tickets?: number; comm?: number; ts?: string; block?: string };
const SECRET = "S3cr3t-KEY-ABCDEF123456";
const PERIOD = { from: "2026-09-21", to: "2026-09-27" };

// TEST FIXTURE -- stands in for a backoffice. Uses the real id "elbet" only so it
// satisfies the data_sources foreign key in the test database.
function fixture(getRows: () => Row[], o: { pages?: number; sinceSpy?: (s: string | null) => void } = {}): Connector {
  return {
    id: "elbet", displayName: "TEST FIXTURE", role: "original_source", status: "implemented", integrationType: "approved_export",
    assessment: { accessMethod: "approved_export", known: [], unknown: [], blockers: [] },
    capabilities: () => ({ agents: true, sales: true }),
    rateLimit: () => ({ minIntervalMs: 2000, maxRetries: 3 }),
    testConnection: async () => ({ ok: true, state: "ok", message: "fixture" }),
    async *fetchWindow(ctx, win): AsyncIterable<RawRecord> {
      o.sinceSpy?.(win.since);
      const key = ctx.getSecret("api_key");
      for (let page = 0; page < (o.pages ?? 1); page++) {
        const res = await ctx.http(`https://backoffice.test/report?from=${win.from}&page=${page}`, { headers: { Authorization: `Bearer ${key}` } });
        const data = (await res.json()) as { rows: Row[] };
        for (const r of page === 0 ? data.rows : []) yield { sourceTimestamp: r.ts ?? "2026-09-28T10:00:00Z", batchType: "EB", periodStart: win.from, periodEnd: win.to, payload: r };
      }
    },
    normalize(raw): NormalizedRecord[] {
      const r = raw.payload as Row;
      if ((r as any).__bad) throw new Error("unparseable");
      return [{ sourceRecordId: `fx-${r.agent}`, sourceTimestamp: raw.sourceTimestamp, batchType: raw.batchType, periodStart: raw.periodStart, periodEnd: raw.periodEnd,
        item: { agentUsername: r.agent, sourceBlock: r.block ?? "EB:LUCKYBALL", tickets: r.tickets ?? 10, stake: r.stake, payout: 0, profit: r.stake, commissionAmount: r.comm ?? 1, commissionType: null, balance: null, moneyWin: null, isHouse: false } }];
    },
  };
}
const respond = (rows: Row[], status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify({ rows }), { status, headers });

async function setup(rows: Row[], o: { pages?: number; fetchImpl?: typeof fetch; secret?: string | undefined; sinceSpy?: (s: string | null) => void } = {}) {
  const db = await freshDb(); const store = new PgStore(db); const fc = fakeClock();
  let current = rows;
  const conn = fixture(() => current, { pages: o.pages, sinceSpy: o.sinceSpy });
  const fetchImpl = o.fetchImpl ?? (async () => respond(current));
  const run = (req = { mode: "full" as const, ...PERIOD }) =>
    runSync({ connector: conn, store, clock: fc.clock, fetchImpl, random: () => 0, getSecret: (n) => (n === "api_key" ? ("secret" in o ? o.secret : SECRET) : undefined), today: () => "2026-09-28" }, req);
  return { db, store, fc, run, set: (r: Row[]) => { current = r; } };
}
const count = async (db: PGlite, sql: string) => Number((await db.query<{ n: string }>(`select count(*)::int as n from (${sql}) x`)).rows[0].n);
const THREE: Row[] = [{ agent: "0619ab-abn-ugocalis", stake: 730500 }, { agent: "0217ab-ihe-jackson", stake: 160902 }, { agent: "0120ak-ika-geoge984", stake: 754832 }];

// =============================== TESTS ===============================
test("migrations v9 -> v10 -> v11 apply cleanly in order on real Postgres, and v10/v11 are re-runnable", async () => {
  const db = await freshDb();
  await db.exec(read("schema_v10_xpool.sql")); await db.exec(read("schema_v11_sync_infrastructure.sql"));
  const t = await db.query<{ n: number }>(`select count(*)::int as n from data_sources`);
  assert.equal(t.rows[0].n, 5);
});

test("first sync inserts rows with full provenance and records a live run", async () => {
  const { db, run } = await setup(THREE);
  const res = await run();
  assert.equal(res.status, "succeeded"); assert.equal(res.counts.inserted, 3);
  const b = (await db.query<any>(`select source_system, integration_type, type, synced_at is not null as ts from batches`)).rows;
  assert.equal(b.length, 1); assert.deepEqual([b[0].source_system, b[0].integration_type, b[0].type, b[0].ts], ["elbet", "approved_export", "EB", true]);
  const li = (await db.query<any>(`select product, source_record_id, synced_at is not null as s from line_items order by agent_username`)).rows;
  assert.equal(li.length, 3); assert.ok(li.every((r) => r.product === "Luckyball" && r.source_record_id.startsWith("fx-") && r.s));
  const sr = (await db.query<any>(`select via, status, records_seen, records_inserted from sync_runs`)).rows[0];
  assert.deepEqual([sr.via, sr.status, sr.records_seen, sr.records_inserted], ["connector", "succeeded", 3, 3]);
});

test("IDEMPOTENT: syncing the same data again changes nothing and creates no duplicates", async () => {
  const { db, run } = await setup(THREE);
  await run();
  const again = await run(); const third = await run();
  for (const r of [again, third]) { assert.equal(r.counts.inserted, 0); assert.equal(r.counts.updated, 0); assert.equal(r.counts.unchanged, 3); assert.equal(r.status, "succeeded"); }
  assert.equal(await count(db, "select 1 from line_items"), 3);
  assert.equal(await count(db, "select 1 from batches"), 1);
  assert.equal(await count(db, "select 1 from sync_runs"), 3);
});

test("a changed value updates in place; a vanished agent is removed; a new agent is added", async () => {
  const { db, run, set } = await setup(THREE);
  await run();
  set([{ agent: "0619ab-abn-ugocalis", stake: 999999 }, { agent: "0217ab-ihe-jackson", stake: 160902 }, { agent: "NEW-AGENT", stake: 5 }]);
  const r = await run();
  assert.deepEqual([r.counts.inserted, r.counts.updated, r.counts.unchanged, r.counts.removed], [1, 1, 1, 1]);
  assert.equal(await count(db, "select 1 from line_items"), 3);
  assert.equal(Number((await db.query<any>(`select stake from line_items where agent_username='0619ab-abn-ugocalis'`)).rows[0].stake), 999999);
  assert.equal(await count(db, `select 1 from line_items where agent_username='0120ak-ika-geoge984'`), 0);
});

test("agent matching is case-insensitive, like the reporting engine", async () => {
  const { db, run, set } = await setup([{ agent: "0619AB-ABN-UGOCALIS", stake: 1 }]);
  await run(); set([{ agent: "0619ab-abn-ugocalis", stake: 1 }]);
  const r = await run();
  assert.equal(r.counts.unchanged, 1); assert.equal(await count(db, "select 1 from line_items"), 1);
});

test("MANUAL UPLOADS ARE PROTECTED: an existing CSV batch for the period is never touched or duplicated", async () => {
  const { db, run } = await setup(THREE);
  await db.exec(`insert into batches (type, filename, period_start, period_end, source_system, integration_type) values ('EB','manual.csv','2026-09-21','2026-09-27','elbet','csv_upload');
                 insert into line_items (batch_id, agent_username, source_block, stake) select id, 'manual-agent', 'EB:LUCKYBALL', 42 from batches;`);
  const r = await run();
  assert.equal(r.status, "partial"); assert.equal(r.counts.inserted, 0); assert.equal(r.counts.skipped, 3);
  assert.match(r.message, /manual\/CSV upload already covers this period/);
  assert.equal(await count(db, "select 1 from batches"), 1);
  assert.equal(await count(db, "select 1 from line_items"), 1);
  assert.equal(Number((await db.query<any>(`select stake from line_items`)).rows[0].stake), 42);
});

test("an OVERLAPPING manual upload also blocks; an adjacent one does not", async () => {
  const a = await setup(THREE);
  await a.db.exec(`insert into batches (type, filename, period_start, period_end, source_system, integration_type) values ('EB','m.csv','2026-09-14','2026-09-24','elbet','csv_upload')`);
  assert.equal((await a.run()).counts.inserted, 0);
  const b = await setup(THREE);
  await b.db.exec(`insert into batches (type, filename, period_start, period_end, source_system, integration_type) values ('EB','m.csv','2026-09-14','2026-09-20','elbet','csv_upload')`);
  assert.equal((await b.run()).counts.inserted, 3);
  assert.equal(await count(b.db, "select 1 from batches"), 2);
});

test("a manual upload of a DIFFERENT backoffice or product type does not block a sync", async () => {
  const { db, run } = await setup(THREE);
  await db.exec(`insert into batches (type, filename, period_start, period_end, source_system, integration_type) values ('GB','g.csv','2026-09-21','2026-09-27','globalbet','csv_upload'), ('EB_MB','mb.csv','2026-09-21','2026-09-27','elbet','csv_upload')`);
  assert.equal((await run()).counts.inserted, 3);
});

test("invalid records are skipped and reported, valid ones still import (partial)", async () => {
  const { db, run } = await setup([...THREE, { agent: "BAD-BLOCK", stake: 1, block: "ZZ:NOPE" }, { agent: "NOTNUM", stake: "abc" as any }, { agent: "  ", stake: 1 }]);
  const r = await run();
  assert.equal(r.status, "partial"); assert.equal(r.counts.inserted, 3); assert.equal(r.counts.skipped, 3);
  assert.equal(await count(db, "select 1 from line_items"), 3);
});

test("duplicate keys in one payload: first wins, the rest are counted, never silent", async () => {
  const { db, run } = await setup([{ agent: "a", stake: 1 }, { agent: "A", stake: 2 }, { agent: "b", stake: 3 }]);
  const r = await run();
  assert.equal(r.counts.inserted, 2); assert.equal(r.counts.skipped, 1); assert.equal(r.status, "partial");
  assert.equal(Number((await db.query<any>(`select stake from line_items where lower(agent_username)='a'`)).rows[0].stake), 1);
});

test("if nothing can be normalized the sync FAILS and imports nothing (source format changed)", async () => {
  const { db, run } = await setup([{ agent: "x", stake: 1, __bad: true } as any]);
  const r = await run();
  assert.equal(r.status, "failed"); assert.match(r.message, /none could be read in the expected format/);
  assert.equal(await count(db, "select 1 from line_items"), 0);
});

test("transient errors are retried with exponential backoff, then succeed", async () => {
  let n = 0;
  const { run, fc } = await setup(THREE, { fetchImpl: async () => (++n <= 2 ? new Response("x", { status: 503 }) : respond(THREE)) });
  const r = await run();
  assert.equal(r.status, "succeeded"); assert.equal(n, 3);
  // Backoff doubles (500 then 1000); the rate limiter adds its own waits in between, so check order, not adjacency.
  const i500 = fc.sleeps.indexOf(500), i1000 = fc.sleeps.indexOf(1000);
  assert.ok(i500 >= 0 && i1000 > i500, `backoff sleeps were ${JSON.stringify(fc.sleeps)}`);
});

test("Retry-After on 429 is honoured", async () => {
  let n = 0;
  const { run, fc } = await setup(THREE, { fetchImpl: async () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "7" } }) : respond(THREE)) });
  await run(); assert.ok(fc.sleeps.includes(7000));
});

test("bad credentials (401) are NOT retried, and the failure is recorded without any data written", async () => {
  let n = 0;
  const { db, run } = await setup(THREE, { fetchImpl: async () => { n++; return new Response("denied", { status: 401 }); } });
  const r = await run();
  assert.equal(n, 1); assert.equal(r.status, "failed"); assert.match(r.message, /HTTP 401/);
  assert.equal(await count(db, "select 1 from line_items"), 0);
  assert.equal((await db.query<any>(`select status from sync_runs`)).rows[0].status, "failed");
});

test("retries are bounded: persistent 503 fails after maxRetries+1 attempts", async () => {
  let n = 0;
  const { run } = await setup(THREE, { fetchImpl: async () => { n++; return new Response("", { status: 503 }); } });
  const r = await run(); assert.equal(n, 4); assert.equal(r.status, "failed");
});

test("RATE LIMIT: requests are spaced at least minInterval apart", async () => {
  const stamps: number[] = [];
  const fcRef: { now?: () => number } = {};
  const { run, fc } = await setup(THREE, { pages: 3, fetchImpl: async () => { stamps.push(fcRef.now!()); return respond(THREE); } });
  fcRef.now = fc.now;
  await run();
  assert.equal(stamps.length, 3);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= 2000, `gap ${stamps[i] - stamps[i - 1]}`);
});

test("SECURITY: a secret that leaks into an error never reaches run history or the response", async () => {
  const { db, run } = await setup(THREE, { fetchImpl: async () => { throw new Error(`connect failed. Authorization: Bearer ${SECRET} cookie=abc123 token=zzz url=https://user:p4ss@host/x`); } });
  const r = await run();
  const stored = JSON.stringify((await db.query(`select * from sync_runs`)).rows);
  for (const text of [r.message, stored]) {
    assert.ok(!text.includes(SECRET), "secret leaked"); assert.ok(!text.includes("p4ss"), "url password leaked"); assert.ok(!text.includes("abc123"), "cookie leaked");
  }
  assert.equal(r.status, "failed");
});

test("a missing secret fails clearly, naming the secret (never a value)", async () => {
  const { run } = await setup(THREE, { secret: undefined });
  const r = await run();
  assert.equal(r.status, "failed"); assert.match(r.message, /api_key/); assert.match(r.message, /not configured/);
});

test("redact(): covers credential shapes without mangling normal text", () => {
  const dirty = `Bearer abc.def-123  Basic dXNlcjpwYXNzd29yZA==  eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sgn  password=hunter2  Cookie: sid=XYZ  https://u:pw@h/  ${"A".repeat(50)}`;
  const out = redact(dirty);
  for (const leak of ["abc.def-123", "dXNlcjpwYXNzd29yZA", "hunter2", "sid=XYZ", "u:pw@", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]) assert.ok(!out.includes(leak), `leaked: ${leak}`);
  const clean = "Backoffice responded with HTTP 503 for 0619ab-abn-ugocalis (stake 730500)";
  assert.equal(redact(clean), clean);
  assert.equal(redact("word ".repeat(200)).length, 501);
  assert.equal(redact("x".repeat(900)), "[REDACTED-LONG-TOKEN]");
});

test("EVERY real connector is not implemented: refused, no run recorded, can never be Connected", async () => {
  assert.deepEqual(Object.keys(CONNECTORS).sort(), ["elbet", "globalbet", "walify", "xpool"]);
  const db = await freshDb(); const store = new PgStore(db);
  for (const c of Object.values(CONNECTORS)) {
    assert.equal(c.status, "not_implemented"); assert.equal(c.integrationType, null); assert.equal(c.capabilities(), null);
    assert.ok(c.assessment.blockers.length > 0 && c.assessment.unknown.length > 0);
    const r = await runSync({ connector: c, store, getSecret: () => "x" }, { mode: "full", ...PERIOD });
    assert.equal(r.status, "refused"); assert.equal(r.ok, false);
    const t = await c.testConnection(buildContext(c, () => undefined).ctx);
    assert.deepEqual([t.ok, t.state], [false, "not_implemented"]);
    await assert.rejects(async () => { for await (const _ of c.fetchWindow(buildContext(c, () => undefined).ctx, { ...PERIOD, since: null })) { /* never */ } }, /not implemented/);
  }
  assert.equal(await count(db, "select 1 from sync_runs"), 0);
  assert.ok(describeConnectors().every((d) => d.status === "not_implemented"));
  assert.equal(liveConnectionStatus([], false), "Not Connected");
});

test("Connected requires a LIVE sync that retrieved real data; CSV uploads and empty syncs never qualify", () => {
  assert.equal(liveConnectionStatus([{ mode: "manual", status: "succeeded", records_seen: 500 }, { via: "csv_upload", mode: "manual", status: "succeeded", records_seen: 9 }]), "Not Connected");
  assert.equal(liveConnectionStatus([{ via: "connector", mode: "full", status: "succeeded", records_seen: 0 }]), "Not Connected");
  assert.equal(liveConnectionStatus([{ via: "connector", mode: "full", status: "succeeded", records_seen: 12 }]), "Connected");
  assert.equal(liveConnectionStatus([{ via: "connector", mode: "full", status: "partial", records_seen: 12 }]), "Connected");
  assert.equal(liveConnectionStatus([{ via: "connector", mode: "full", status: "failed" }, { via: "connector", mode: "full", status: "succeeded", records_seen: 12 }]), "Sync Failed");
  assert.equal(liveConnectionStatus([{ via: "connector", mode: "full", status: "running" }]), "Syncing");
  assert.equal(liveConnectionStatus([{ via: "connector", mode: "full", status: "succeeded", records_seen: 12 }], true), "Disabled");
  assert.equal(liveConnectionStatus([{ mode: "incremental", status: "succeeded", records_seen: 3 }]), "Connected"); // pre-v11 row: classed by mode
});

test("incremental sync resumes from the last watermark", async () => {
  const seen: Array<string | null> = [];
  const { run } = await setup([{ agent: "a", stake: 1, ts: "2026-09-26T08:30:00Z" }], { sinceSpy: (s) => seen.push(s) });
  await run();
  await run({ mode: "incremental" } as any);
  assert.equal(seen[0], null); assert.ok(seen[1]?.startsWith("2026-09-26"), `since was ${seen[1]}`);
});

test("a window is required for a first/full sync, and must be valid", async () => {
  const { run } = await setup(THREE);
  assert.equal((await run({ mode: "full" } as any)).status, "refused");
  assert.equal((await run({ mode: "full", from: "2026-09-27", to: "2026-09-21" })).status, "refused");
  assert.equal((await run({ mode: "full", from: "not-a-date", to: "2026-09-21" })).status, "refused");
});

test("only one sync per backoffice at a time; a stale 'running' row does not block forever", async () => {
  const { db, run } = await setup(THREE);
  await db.exec(`insert into sync_runs (source_id, mode, status, via) values ('elbet','full','running','connector')`);
  assert.equal((await run()).status, "refused");
  await db.exec(`update sync_runs set started_at = now() - interval '2 hours'`);
  assert.equal((await run()).status, "succeeded");
});

test("record keys are deterministic and case-insensitive on the agent", () => {
  assert.equal(recordKey("elbet", "EB:LUCKYBALL", " Agent-X ", "2026-09-21", "2026-09-27"), recordKey("elbet", "EB:LUCKYBALL", "agent-x", "2026-09-21", "2026-09-27"));
  assert.notEqual(recordKey("elbet", "EB:LUCKYBALL", "a", "2026-09-21", "2026-09-27"), recordKey("elbet", "EB:LUCKYGREECK", "a", "2026-09-21", "2026-09-27"));
});

test("PARITY: server product mapping == the dashboard engine == the SQL backfill, for every block", async () => {
  const blocks = ["GB:BLOCK_A", "GB:FIN_OVERVIEW", "EB:LUCKYBALL", "EB:LUCKYGREECK", "EB:ROCKET_MAN", "EB:LUCKYBALL_DUP", "EB:COMBINED_TOTAL", "EB_MB:BASE", "SP:BASE", "SP:35PCT", "SP:POOL", "SP_MB:BASE", "SP_MB:ABOVE_100", "XP:OWN", "ZZ:UNKNOWN"];
  const db = await freshDb();
  await db.exec(`insert into batches (type, filename) values ('GB','x')`);
  for (const b of blocks) await db.query(`insert into line_items (batch_id, agent_username, source_block) select id, 'a', $1 from batches`, [b]);
  const caseStmt = read("schema_v9_data_sources.sql").match(/update line_items set product = case[\s\S]*?end where product is null;/)![0];
  await db.exec(`update line_items set product = null; ${caseStmt}`);
  const sql = Object.fromEntries((await db.query<any>(`select source_block, product from line_items`)).rows.map((r) => [r.source_block, r.product]));
  for (const b of blocks) { assert.equal(productOfBlock(b), productOf(b), `server vs engine: ${b}`); assert.equal(sql[b], productOf(b), `SQL vs engine: ${b}`); }
});

test("SQL function: refuses CSV integration, is atomic on failure, and is callable only by the service role", async () => {
  const db = await freshDb();
  await assert.rejects(db.query(`select sync_apply_batch('elbet','EB','2026-09-21','2026-09-27','csv_upload','[]'::jsonb)`), /live connectors only/);
  const dup = JSON.stringify([{ agent_username: "a", source_block: "EB:LUCKYBALL", is_house: false }, { agent_username: "A", source_block: "EB:LUCKYBALL", is_house: false }]);
  await assert.rejects(db.query(`select sync_apply_batch('elbet','EB','2026-09-21','2026-09-27','approved_export',$1::jsonb)`, [dup]));
  assert.equal(await count(db, "select 1 from batches"), 0, "failed apply must roll back the batch it created");
  assert.equal(await count(db, "select 1 from line_items"), 0);
  const sig = "sync_apply_batch(text,text,date,date,text,jsonb,uuid)";
  const p = (role: string) => db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${sig}', 'execute') as ok`).then((r) => r.rows[0].ok);
  assert.deepEqual([await p("service_role"), await p("anon"), await p("authenticated")], [true, false, false]);
});

test("a sync batch never leaks into other sources: sources stay separately identifiable", async () => {
  const { db, run } = await setup(THREE);
  await run();
  assert.equal(await count(db, `select 1 from batches where source_system <> 'elbet'`), 0);
});

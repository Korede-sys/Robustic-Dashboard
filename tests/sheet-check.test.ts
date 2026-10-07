// Sheet vs dashboard comparison, and migration 13. SYNTHETIC data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
// @ts-ignore -- plain JS module shared with the dashboard
import { compareToSheet, TOLERANCE } from "../src/lib/sheetCheck.js";

const sf = (agentUsername: string, o: any = {}) => ({ agentUsername, commission: 1000, bonus: 500, palliative: 100, gift: 50, totalEarnings: 1650, ...o });
const ag = (username: string, o: any = {}) => ({ username, sourceCommission: 1000, bonus: 500, palliative: 100, gift: 50, channel: "branch", hasEdit: false, hasAdjustment: false, ...o });
const cmp = (figs: any[], agents: any[], forty: string[] = [], noSupp: string[] = []) =>
  compareToSheet({ sheetFigures: figs, agents, fortyPercentAgents: new Set(forty), noSupplementalAgents: new Set(noSupp) });
const one = (r: any) => r.rows[0];

test("everything equal -> match", () => {
  const r = cmp([sf("a")], [ag("a")]);
  assert.equal(one(r).state, "match"); assert.deepEqual([r.compared, r.agree, r.unexplained], [1, 1, 0]);
});

test("KUBWA: the sheet printed no bonus, the dashboard calculates one -> flagged, with the exact fields", () => {
  const r = cmp([sf("kubwa", { bonus: 0, palliative: 0, gift: 0, totalEarnings: 1000 })], [ag("kubwa")]);
  assert.equal(one(r).state, "differs"); assert.deepEqual(one(r).fields, ["bonus", "palliative", "gift", "total"]);
  assert.equal(one(r).diff.total, 650); assert.equal(r.unexplained, 1);
});

test("rounding differences below the tolerance are not differences", () => {
  assert.equal(one(cmp([sf("a", { commission: 1000.3 })], [ag("a")])).state, "match");
  assert.equal(one(cmp([sf("a", { commission: 1000 + TOLERANCE + 0.01 })], [ag("a")])).state, "differs");
});

test("missing printed values count as 0, not as a crash", () => {
  assert.equal(one(cmp([sf("a", { bonus: null, palliative: undefined, gift: null, totalEarnings: null })], [ag("a", { bonus: 0, palliative: 0, gift: 0, sourceCommission: 1000 })])).state, "differs"); // total 1000 vs printed 0
  assert.equal(one(cmp([sf("a", { bonus: null, palliative: null, gift: null, totalEarnings: 1000 })], [ag("a", { bonus: 0, palliative: 0, gift: 0 })])).state, "match");
});

test("known rules explain a difference instead of raising an alarm: online, 40% plan, no-bonus plan", () => {
  assert.equal(one(cmp([sf("on")], [ag("on", { channel: "online", sourceCommission: 0, bonus: 0, palliative: 0, gift: 0 })])).state, "explained");
  const forty = one(cmp([sf("f")], [ag("f", { sourceCommission: 700, bonus: 0, palliative: 0, gift: 0 })], ["f"]));
  assert.equal(forty.state, "explained"); assert.match(forty.reasons[0], /40%/);
  const nosupp = one(cmp([sf("n")], [ag("n", { bonus: 0, palliative: 0, gift: 0 })], [], ["n"]));
  assert.equal(nosupp.state, "explained"); assert.match(nosupp.reasons[0], /no-bonus/);
});

test("a no-bonus plan does NOT excuse a COMMISSION difference", () => {
  const r = one(cmp([sf("n")], [ag("n", { bonus: 0, palliative: 0, gift: 0, sourceCommission: 400 })], [], ["n"]));
  assert.equal(r.state, "differs"); assert.ok(r.fields.includes("commission"));
});

test("a deliberate correction is labelled as such, and once aligned with the sheet it is simply a match", () => {
  const diff = one(cmp([sf("c", { bonus: 0, totalEarnings: 1150 })], [ag("c", { hasEdit: true })]));
  assert.equal(diff.state, "corrected"); assert.match(diff.reasons[0], /corrected/i);
  assert.equal(one(cmp([sf("c")], [ag("c", { hasEdit: true })])).state, "match");
});

test("a sheet row the dashboard does not count is reported, not silently dropped", () => {
  const r = cmp([sf("ghost")], []);
  assert.equal(one(r).state, "not-counted"); assert.equal(r.counts["not-counted"], 1);
});

test("a sheet whose printed total disagrees with its own components still sorts the worst difference first", () => {
  const r = cmp([sf("small", { bonus: 0 }), sf("big", { bonus: 0, palliative: 0, gift: 0 })], [ag("small"), ag("big")]);   // printed totals left at 1650 (inconsistent)
  assert.deepEqual(r.rows.map((x: any) => x.agent), ["big", "small"]);
});

test("agent names match regardless of case; the worst differences sort first", () => {
  const r = cmp([sf("OK-agent"), sf("small", { bonus: 0, totalEarnings: 1150 }), sf("big", { bonus: 0, palliative: 0, gift: 0, totalEarnings: 1000 })], [ag("ok-AGENT"), ag("small"), ag("big")]);
  assert.deepEqual(r.rows.map((x: any) => x.agent), ["big", "small", "OK-agent"]);
  assert.deepEqual(r.counts, { match: 1, explained: 0, corrected: 0, differs: 2, "not-counted": 0 });
});

// ------------------------------------------------------------------ migration 13 on real Postgres
async function freshDb() {
  const db = new PGlite();
  await db.exec(`create table profiles (id uuid primary key default gen_random_uuid());
    create function get_my_role() returns text language sql as $$ select 'admin'::text $$;`);
  await db.exec((readFileSync(new URL("../schema.sql", import.meta.url).pathname, "utf8").match(/create table (?:batches|line_items) \([\s\S]*?\n\);/g) ?? []).join("\n"));
  await db.exec(readFileSync(new URL("../schema_v13_sheet_figures.sql", import.meta.url).pathname, "utf8"));
  await db.exec(`insert into batches (type, filename) values ('GB','w.csv')`);
  return db;
}
test("migration 13: one row per agent per week, numbers stored as printed, removed with the week, safe to re-run", async () => {
  const db = await freshDb(); const id = (await db.query<{ id: string }>(`select id from batches`)).rows[0].id;
  const ins = (agent: string) => db.query(`insert into sheet_figures (batch_id, agent_username, commission, bonus, palliative, gift, total_earnings) values ($1,$2,45118.744,15000,10000,4832.056,74950.8)`, [id, agent]);
  await ins("a"); await assert.rejects(ins("a"), /unique|duplicate|primary/i);
  assert.equal(Number((await db.query<any>(`select commission from sheet_figures`)).rows[0].commission), 45118.744, "no rounding of what the sheet printed");
  await db.exec(readFileSync(new URL("../schema_v13_sheet_figures.sql", import.meta.url).pathname, "utf8"));   // re-run
  assert.equal(Number((await db.query<any>(`select count(*)::int as n from sheet_figures`)).rows[0].n), 1);
  await db.query(`delete from batches where id=$1`, [id]);
  assert.equal(Number((await db.query<any>(`select count(*)::int as n from sheet_figures`)).rows[0].n), 0);
});

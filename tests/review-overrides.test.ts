// Review & Adjust: per-week overrides of Bonus / Palliative / Gift, per-line commission corrections, and the
// migration that stores them. SYNTHETIC data only (the amounts come from one verified worked example).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
// @ts-ignore -- plain JS modules shared with the dashboard
import { PARSERS, aggregateBatches, adjustmentKey } from "../src/lib/engine-core.js";
// @ts-ignore
import { parseCSV } from "../src/lib/csvparse.js";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");
const eu = (n: number) => n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function treeItems(agents: Array<{ u: string; tickets: number; totalIn: number; totalOut: number; jp3?: number; commission: number; profit: number }>) {
  const row = (c: string[]) => c.map((x) => `"${x}"`).join(";");
  const zero = Array(13).fill("0,00");
  const lines = [`"Financial Overview report for agent All from 2026-09-28 00:00 to 2026-10-05 00:00 (all players included)."`,
    row(["Username", "Name", "T", "Tickets Count", "Currency", "Total In", "Total Out", "Open payouts", "J1", "J2", "J3", "C1", "C2", "C3", "Reversal", "Commission", "Taxes", "Profit"]),
    row(["\\__ ROOT", "R", "A", "9", "Total in EUR", ...zero]), row(["    |   ", " ", " ", " ", "NGN", ...zero])];
  for (const a of agents) {
    lines.push(row([`    |__ ${a.u}`, "T", "A", String(a.tickets), "Total in EUR", ...zero]));
    lines.push(row(["    |   |   ", " ", " ", " ", "NGN", eu(a.totalIn), eu(a.totalOut), "0,00", "0,00", "0,00", eu(a.jp3 ?? 0), "0,00", "0,00", "0,00", "0,00", eu(a.commission), "0,00", eu(a.profit)]));
  }
  return PARSERS.GB(parseCSV(lines.join("\n"))).items;
}
const EX = { tickets: 3905, totalIn: 1051900, totalOut: 875194, jp3: 5418, commission: 41017.04, profit: 171288 };   // verified: pays 45118.744 + 15000 + 10000 + 4832.056
const batch = (id: string, items: any[], supplemental: any[] = []) => ({ id, type: "GB", filename: id, items, supplemental, periodStart: "2026-09-28", periodEnd: "2026-10-04" });
const ov = (batchId: string, agent: string, field: string, overrideValue: number, extra: any = {}) =>
  ({ id: `${batchId}-${agent}-${field}`, batchId, agentUsername: agent, field, overrideValue, originalValue: null, reason: "test", createdBy: "Tester", createdAt: "2026-10-07T10:00:00Z", ...extra });
const find = (r: any, u: string) => r.agents.find((x: any) => x.username.toLowerCase() === u.toLowerCase());
const run = (bs: any[], o: any[] = [], adj: any[] = [], forty = new Set<string>(), noSupp = new Set<string>(), opts = {}) =>
  aggregateBatches(bs, undefined, adj, forty, noSupp, o, opts);

test("baseline: the worked example pays commission + bonus + palliative + gift", () => {
  const a = find(run([batch("w", treeItems([{ u: "0100ab-abn-kubwa", ...EX }]))]), "0100ab-abn-kubwa");
  assert.deepEqual([a.bonus, a.palliative], [15000, 10000]); assert.ok(Math.abs(a.gift - 4832.056) < 1e-6); assert.equal(a.hasEdit, false);
});

test("KUBWA CASE: zero bonus, palliative and gift for one agent in one week; commission untouched", () => {
  const items = treeItems([{ u: "0100ab-abn-kubwa", ...EX }, { u: "0100ab-abn-other", ...EX }]);
  const r = run([batch("w", items)], ["bonus", "palliative", "gift"].map((f) => ov("w", "0100ab-abn-kubwa", f, 0)));
  const k = find(r, "0100ab-abn-kubwa"), o = find(r, "0100ab-abn-other");
  assert.deepEqual([k.bonus, k.palliative, k.gift, k.monthlyBonus], [0, 0, 0, 0]);
  assert.ok(Math.abs(k.sourceCommission - 45118.744) < 1e-6, "commission still paid");
  assert.ok(Math.abs(k.totalEarnings - 45118.744) < 1e-6, "total earnings follows the edit, not the sheet");
  assert.equal(k.hasEdit, true); assert.deepEqual([...k.editedFields].sort(), ["bonus", "gift", "palliative"]);
  assert.equal(o.bonus, 15000, "a different agent is untouched");
  assert.equal(r.overrides.length, 3);
  assert.deepEqual(r.overrides.map((x: any) => x.system).sort((a: number, b: number) => a - b).map((n: number) => Math.round(n)), [4832, 10000, 15000], "the calculated value is reported beside each override");
});

test("an override stays inside its own week", () => {
  const w1 = batch("w1", treeItems([{ u: "0100ab-abn-kubwa", ...EX }])), w2 = batch("w2", treeItems([{ u: "0100ab-abn-kubwa", ...EX }]));
  const a = find(run([w1, w2], [ov("w2", "0100ab-abn-kubwa", "bonus", 0)]), "0100ab-abn-kubwa");
  assert.equal(a.bonus, 15000, "week 1 keeps its bonus; week 2's was zeroed");
});

test("an override for a week that is not being viewed is ignored", () => {
  const a = find(run([batch("w1", treeItems([{ u: "0100ab-abn-kubwa", ...EX }]))], [ov("some-other-week", "0100ab-abn-kubwa", "bonus", 0)]), "0100ab-abn-kubwa");
  assert.equal(a.bonus, 15000); assert.equal(a.hasEdit, false);
});

test("an override can ADD a payment the system calculated as nothing", () => {
  const small = { tickets: 100, totalIn: 50000, totalOut: 49000, commission: 1000, profit: 1000 };   // profit too low for any gift: 35% x 1,000 < the 1,100 commission
  assert.equal(find(run([batch("w", treeItems([{ u: "0100ab-abn-small", ...small }]))]), "0100ab-abn-small").gift, 0);
  const r = run([batch("w", treeItems([{ u: "0100ab-abn-small", ...small }]))], [ov("w", "0100ab-abn-small", "gift", 5000)]);
  const a = find(r, "0100ab-abn-small");
  assert.equal(a.gift, 5000); assert.equal(a.monthlyBonus, 5000); assert.equal(r.overrides[0].system, 0);
});

test("an override beats the automatic exclusions: online agent, 40% plan, no_supplemental_pay", () => {
  const items = treeItems([{ u: "elb-onlineguy", ...EX }, { u: "0100ab-abn-forty", ...EX }, { u: "0100ab-abn-nosupp", ...EX }]);
  const r = run([batch("w", items)], ["elb-onlineguy", "0100ab-abn-forty", "0100ab-abn-nosupp"].map((u) => ov("w", u, "bonus", 3000)),
    [], new Set(["0100ab-abn-forty"]), new Set(["0100ab-abn-nosupp"]));
  for (const u of ["elb-onlineguy", "0100ab-abn-forty", "0100ab-abn-nosupp"]) assert.equal(find(r, u).bonus, 3000, u);
  assert.equal(find(r, "0100ab-abn-forty").palliative, 0, "only the overridden field changes; the exclusion still applies to the rest");
});

test("a legacy-sheet supplemental entry is overridable the same way", () => {
  const items = treeItems([{ u: "0100ab-abn-sheet", ...EX }]).map((i: any) => ({ ...i, sourceBlock: "GB:BLOCK_A" }));
  const b = batch("w", items, [{ agentUsername: "0100ab-abn-sheet", type: "bonus", amount: 9000 }]);
  assert.equal(find(run([b]), "0100ab-abn-sheet").bonus, 9000);
  assert.equal(find(run([b], [ov("w", "0100ab-abn-sheet", "bonus", 0)]), "0100ab-abn-sheet").bonus, 0);
});

test("removing the override restores the calculated figure", () => {
  const b = batch("w", treeItems([{ u: "0100ab-abn-kubwa", ...EX }]));
  assert.equal(find(run([b], [ov("w", "0100ab-abn-kubwa", "bonus", 0)]), "0100ab-abn-kubwa").bonus, 0);
  assert.equal(find(run([b], []), "0100ab-abn-kubwa").bonus, 15000);
});

test("SPARESHOP CASE: a commission correction for one line (the existing adjustment) feeds total earnings", () => {
  const items = treeItems([{ u: "0100ab-abn-spare", ...EX, commission: 21167.97 }]);
  const adj = [{ id: "a1", batchId: "w", agentUsername: "0100ab-abn-spare", sourceBlock: "GB:FIN_OVERVIEW", originalCommission: 21167.97, adjustedCommission: 11642.38, reason: "negotiated 55%", createdBy: "Tester", createdAt: "2026-10-07" }];
  const a = find(run([batch("w", items)], [], adj, new Set(), new Set(["0100ab-abn-spare"])), "0100ab-abn-spare");
  assert.equal(a.sourceCommission, 11642.38); assert.equal(a.hasAdjustment, true);
  assert.ok(Math.abs(a.totalEarnings - 11642.38) < 1e-6, "no supplemental on this plan; total = the corrected commission");
  assert.equal(adjustmentKey("w", "0100AB-abn-spare", "GB:FIN_OVERVIEW"), adjustmentKey("w", "0100ab-abn-spare", "GB:FIN_OVERVIEW"));
});

test("per-line view (for the Review page) is opt-in and reports what each line pays", () => {
  const b = batch("w", treeItems([{ u: "0100ab-abn-kubwa", ...EX }]));
  assert.equal(run([b]).lines.length, 0);
  const l = run([b], [], [], new Set(), new Set(), { lines: true }).lines;
  assert.equal(l.length, 1); assert.equal(l[0].block, "GB:FIN_OVERVIEW"); assert.equal(l[0].sheetCommission, 41017.04); assert.ok(Math.abs(l[0].payableCommission - 45118.744) < 1e-6);
});

test("totals stay consistent with the agents after edits", () => {
  const items = treeItems([{ u: "0100ab-abn-kubwa", ...EX }, { u: "0100ab-abn-other", ...EX }]);
  const r = run([batch("w", items)], [ov("w", "0100ab-abn-kubwa", "gift", 0)]);
  assert.ok(Math.abs(r.totals.monthlyBonus - r.agents.reduce((s: number, a: any) => s + a.monthlyBonus, 0)) < 1e-9);
});

// ---------------------------------------------------------------- the migration, on real Postgres
async function freshDb() {
  const db = new PGlite();
  await db.exec(`create table profiles (id uuid primary key default gen_random_uuid());
    create function get_my_role() returns text language sql as $$ select 'admin'::text $$;`);
  await db.exec((read("schema.sql").match(/create table (?:batches|line_items) \([\s\S]*?\n\);/g) ?? []).join("\n"));
  await db.exec(read("schema_v12_review_and_overrides.sql"));
  await db.exec(`insert into batches (type, filename) values ('GB','w.csv')`);
  return db;
}
const batchId = async (db: PGlite) => (await db.query<{ id: string }>(`select id from batches limit 1`)).rows[0].id;

test("migration 12: one override per agent, field and week; reason required; no negatives; zero allowed", async () => {
  const db = await freshDb(); const id = await batchId(db);
  const ins = (field: string, val: number, reason = "why") => db.query(`insert into row_overrides (batch_id, agent_username, field, override_value, reason) values ($1,'a',$2,$3,$4)`, [id, field, val, reason]);
  await ins("bonus", 0);                                          // zero is a legitimate override
  await assert.rejects(ins("bonus", 5), /unique|duplicate/i);     // re-saving must update, not stack
  await assert.rejects(ins("gift", -1), /check/i);
  await assert.rejects(ins("gift", 1, "   "), /check/i);          // a reason is mandatory
  await assert.rejects(ins("commission", 1), /check/i);           // commission uses manual_adjustments, not this table
  await ins("palliative", 10);
});

test("migration 12: deleting a week removes its overrides and reviews; the file is safe to run twice", async () => {
  const db = await freshDb(); const id = await batchId(db);
  await db.query(`insert into row_overrides (batch_id, agent_username, field, override_value, reason) values ($1,'a','bonus',0,'r')`, [id]);
  await db.query(`insert into batch_reviews (batch_id, note) values ($1,'ok')`, [id]);
  await db.exec(read("schema_v12_review_and_overrides.sql"));    // re-run
  assert.equal(Number((await db.query<any>(`select count(*)::int as n from row_overrides`)).rows[0].n), 1, "re-running changes no data");
  await db.query(`delete from batches where id = $1`, [id]);
  assert.equal(Number((await db.query<any>(`select (select count(*) from row_overrides) + (select count(*) from batch_reviews) as n`)).rows[0].n), 0);
});

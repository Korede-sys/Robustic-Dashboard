// Globalbet "Financial Overview" (tree) handling. SYNTHETIC data only: the numbers for
// the worked example come from one verified agent row, and every name is made up.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- plain JS modules shared with the dashboard
import { PARSERS, aggregateBatches, deriveGlobalbetSupplemental, GB_COMMISSION_UPLIFT } from "../src/lib/engine-core.js";
// @ts-ignore
import { parseCSV } from "../src/lib/csvparse.js";

const eu = (n: number) => n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
// One agent = a "Total in EUR" row plus an NGN row, exactly as Globalbet exports them (semicolon-separated).
function tree(agents: Array<{ u: string; tickets: number; totalIn: number; reversal?: number; totalOut: number; jp3?: number; commission: number; profit: number }>) {
  const lines = [
    `"Financial Overview report for agent All from 2026-09-28 00:00 to 2026-10-05 00:00 generated at 2026-10-06 12:24 (all players included)."`,
    `"Username";"Name";"T";"Tickets Count";"Currency";"Total In";"Total Out";"Open payouts";"Jackpot 1";"Jackpot 2";"Jackpot 3";"Jackpot 1 Contribution";"Jackpot 2 Contribution";"Jackpot 3 Contribution";"Reversal";"Commission";"Taxes";"Profit"`,
  ];
  const row = (cells: string[]) => cells.map((c) => `"${c}"`).join(";");
  lines.push(row(["\\__ ROOT", "Reseller", "A", "999", "Total in EUR", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00"]));
  lines.push(row(["    |   ", " ", " ", " ", "NGN", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00"]));
  for (const a of agents) {
    lines.push(row([`    |__ ${a.u}`, "Test Agent", "A", String(a.tickets), "Total in EUR", "1,00", "1,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "1,00"]));
    lines.push(row(["    |   |   ", " ", " ", " ", "NGN", eu(a.totalIn), eu(a.totalOut), "0,00", "0,00", "0,00", eu(a.jp3 ?? 0), "0,00", "0,00", "0,00", eu(a.reversal ?? 0), eu(a.commission), "0,00", eu(a.profit)]));
  }
  return parseCSV(lines.join("\n"));
}
const parse = (agents: Parameters<typeof tree>[0]) => PARSERS.GB(tree(agents));
const batch = (id: string, items: any[], supplemental: any[] = [], ps: string | null = "2026-09-28", pe: string | null = "2026-10-04", type = "GB") =>
  ({ id, type, filename: id, items, supplemental, periodStart: ps, periodEnd: pe });
const agg = (bs: any[], forty = new Set<string>(), noSupp = new Set<string>()) => aggregateBatches(bs, undefined, [], forty, noSupp);
const find = (a: any, u: string) => a.agents.find((x: any) => x.username.toLowerCase() === u.toLowerCase());

// The verified worked example (numbers from one real agent row; the name is invented).
const EX = { u: "0100ab-abn-testagent", tickets: 3905, totalIn: 1055600, reversal: 3700, totalOut: 875194, jp3: 5418, commission: 41017.04, profit: 171288 };

test("the tree parser takes stake NET of Reversal, and leaves payout, profit and base commission alone", () => {
  const { items } = parse([EX]);
  const it = items.find((i: any) => i.agentUsername === EX.u);
  assert.equal(it.stake, 1051900);
  assert.equal(it.payout, 875194); assert.equal(it.profit, 171288); assert.equal(it.commissionAmount, 41017.04); assert.equal(it.tickets, 3905);
});

test("an agent with no reversal is unaffected", () => {
  const { items } = parse([{ ...EX, u: "0100ab-abn-norev", reversal: 0 }]);
  assert.equal(items[0].stake, 1055600);
});

test("a tree-only week: uplifted commission, bonus, palliative, gift, total earnings, balance and avg stake all match the sheet", () => {
  const { items, supplemental } = parse([EX]);
  assert.equal(supplemental.length, 0, "the parser itself invents nothing");
  const a = find(agg([batch("w", items, supplemental)]), EX.u);
  const want: Record<string, number> = { stake: 1051900, sourceCommission: 45118.744, bonus: 15000, palliative: 10000, gift: 4832.056, totalEarnings: 74950.8, balance: 96337.2 };
  for (const [k, v] of Object.entries(want)) assert.ok(Math.abs(a[k] - v) < 0.001, `${k}: ${a[k]} vs ${v}`);
  assert.ok(Math.abs(a.avgStake - 1051900 / 3905) < 1e-9);
});

test("the shared formula helper: tiers, eligibility, caps", () => {
  const d = (tickets: number, stake: number, profit: number, uplift: number) => deriveGlobalbetSupplemental({ tickets, stake, profit, uplift });
  assert.deepEqual(d(799, 900000, 200000, 0), { bonus: 0, palliative: 0, gift: Math.min(20000, 70000) });           // below 800 tickets: no bonus, not palliative-eligible
  assert.equal(d(2500, 800000, 0, 0).bonus, 15000);                                                                  // top tier needs BOTH
  assert.equal(d(2500, 799999, 0, 0).bonus, 9000);                                                                   // the lower tier wins
  assert.equal(d(3000, 199999, 500000, 0).palliative, 0);                                                            // stake under 200,000: ineligible
  assert.equal(d(1000, 300000, 1e6, 10000).palliative, 10000);                                                       // capped at 10,000
  assert.equal(d(1000, 300000, 1e6, 0).gift, 10000);                                                                 // gift = 20,000 ceiling - 10,000
  assert.equal(GB_COMMISSION_UPLIFT, 1.1);
});

test("policy exclusions still apply to tree-derived pay: online, 40% plan, no-supplemental", () => {
  const { items } = parse([{ ...EX, u: "elb-testonline" }, { ...EX, u: "0100ab-abn-forty" }, { ...EX, u: "0100ab-abn-nosupp" }]);
  const r = agg([batch("w", items)], new Set(["0100ab-abn-forty"]), new Set(["0100ab-abn-nosupp"]));
  const online = find(r, "elb-testonline"), forty = find(r, "0100ab-abn-forty"), noSupp = find(r, "0100ab-abn-nosupp");
  assert.equal(online.sourceCommission, 0); assert.equal(online.bonus + online.palliative + online.gift, 0);
  assert.ok(Math.abs(forty.sourceCommission - 0.4 * 171288) < 0.001, "40% of profit replaces the commission"); assert.equal(forty.bonus + forty.palliative + forty.gift, 0);
  assert.equal(noSupp.bonus + noSupp.palliative + noSupp.gift, 0); assert.equal(noSupp.sourceCommission, 41017.04, "no uplift is invented for the negotiated agent");
  assert.equal(online.stake, 1051900, "online stake still counts toward totals");
});

test("CROSS-WEEK: a sheet in one week must not suppress a tree-only week for the same agent", () => {
  const week1 = batch("w1", parse([{ ...EX, totalIn: 730500, reversal: 0, tickets: 3356, commission: 30852.14, profit: 190638 }]).items.map((i: any) => ({ ...i, sourceBlock: "GB:BLOCK_A" })), [], "2026-09-21", "2026-09-27");
  const week2 = batch("w2", parse([EX]).items, [], "2026-09-28", "2026-10-04");
  assert.equal(find(agg([week1, week2]), EX.u).stake, 730500 + 1051900, "both weeks counted (before the fix this was 730,500)");
});

test("same week, both formats: the legacy sheet wins and nothing is counted twice", () => {
  const legacy = batch("l", parse([EX]).items.map((i: any) => ({ ...i, sourceBlock: "GB:BLOCK_A", commissionAmount: 45118.744 })), [], "2026-09-28", "2026-10-04");
  const treeB = batch("t", parse([EX]).items, [], "2026-09-28", "2026-10-05");   // one-day boundary difference: still the same week
  assert.equal(find(agg([legacy, treeB]), EX.u).stake, 1051900);
});

test("adjacent weeks sharing a boundary day are different weeks; unknown periods keep the old suppress rule", () => {
  const a = batch("a", parse([EX]).items.map((i: any) => ({ ...i, sourceBlock: "GB:BLOCK_A" })), [], "2026-09-21", "2026-09-28");
  const b = batch("b", parse([EX]).items, [], "2026-09-28", "2026-10-05");
  assert.equal(find(agg([a, b]), EX.u).stake, 2 * 1051900, "one shared day out of eight is not the same week");
  const u1 = batch("u1", a.items, [], null, null), u2 = batch("u2", b.items, [], null, null);
  assert.equal(find(agg([u1, u2]), EX.u).stake, 1051900, "unknown periods: legacy suppresses the tree, as before");
});

test("several weeks combined: Avg Stake / Total Earnings / Balance are recomputed across all of them, not taken from one week", () => {
  const w1 = batch("w1", parse([EX]).items, [], "2026-09-21", "2026-09-27"), w2 = batch("w2", parse([EX]).items, [], "2026-09-28", "2026-10-04");
  const a = find(agg([w1, w2]), EX.u);
  assert.ok(Math.abs(a.totalEarnings - 2 * 74950.8) < 0.01);
  assert.ok(Math.abs(a.balance - 2 * 96337.2) < 0.01);
  assert.ok(Math.abs(a.avgStake - 1051900 / 3905) < 1e-9);
});

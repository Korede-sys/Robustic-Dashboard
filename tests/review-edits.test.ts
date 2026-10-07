// The decisions behind the Review & Adjust form: what gets saved, what gets removed, what is refused.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- plain JS module shared with the dashboard
import { planEdits, parseAmount } from "../src/lib/reviewEdits.js";

const B = "w1", A = "0100ab-abn-kubwa";
const current = { bonus: 15000, palliative: 10000, gift: 4832.056 };
const base = { bonus: 15000, palliative: 10000, gift: 4832.056 };
const lines = [{ batchId: B, agent: A, block: "GB:FIN_OVERVIEW", sheetCommission: 41017.04, payableCommission: 45118.744 }];
const baseLines = lines;
const plan = (form: any, over: any = {}) => planEdits({ batchId: B, agent: A, current, base, lines, baseLines, form: { reason: "because", ...form }, adjustments: [], overrides: [], ...over });

test("parseAmount: thousands separators and currency symbol are fine; blanks, text and negatives are not", () => {
  assert.equal(parseAmount("1,234.50"), 1234.5); assert.equal(parseAmount(" ₦ 15000 "), 15000); assert.equal(parseAmount("0"), 0);
  for (const bad of ["", "  ", "abc", "-5", "1e999", null, undefined]) assert.equal(parseAmount(bad as any), null, String(bad));
});

test("nothing changed -> nothing to save, and no reason is demanded", () => {
  const r = plan({ bonus: "15000", palliative: "10000", gift: "4832.056", commission: { "GB:FIN_OVERVIEW": "45118.744" }, reason: "" });
  assert.deepEqual([r.ok, r.changed, r.supp.length, r.commission.length], [true, false, 0, 0]);
});

test("KUBWA: zeroing the three supplemental payments saves three overrides that remember the calculated values", () => {
  const r = plan({ bonus: "0", palliative: "0", gift: "0" });
  assert.equal(r.ok, true); assert.equal(r.supp.length, 3);
  assert.deepEqual(r.supp.map((o: any) => [o.field, o.value, o.op]), [["bonus", 0, "save"], ["palliative", 0, "save"], ["gift", 0, "save"]]);
  assert.deepEqual(r.supp.map((o: any) => Math.round(o.original)), [15000, 10000, 4832]);
});

test("SPARESHOP: a corrected commission saves one adjustment that remembers the sheet value", () => {
  const r = plan({ commission: { "GB:FIN_OVERVIEW": "11,642.38" } });
  assert.deepEqual(r.commission, [{ op: "save", block: "GB:FIN_OVERVIEW", original: 41017.04, adjusted: 11642.38 }]);
});

test("a reason is required whenever something changes", () => {
  const r = plan({ bonus: "0", reason: "   " });
  assert.equal(r.ok, false); assert.match(r.error, /reason/i);
});

test("bad numbers are refused with a message that names the field", () => {
  assert.match(plan({ bonus: "lots" }).error, /Bonus/);
  assert.match(plan({ gift: "-3" }).error, /Gift/);
  assert.match(plan({ commission: { "GB:FIN_OVERVIEW": "" } }).error, /GB:FIN_OVERVIEW/);
});

test("typing the calculated value back REMOVES the existing correction instead of stacking a redundant one", () => {
  const overridden = { ...current, bonus: 0 };
  const existingOv = [{ id: "ov1", batchId: B, agentUsername: A, field: "bonus" }];
  const r = plan({ bonus: "15000" }, { current: overridden, overrides: existingOv });
  assert.deepEqual(r.supp, [{ op: "delete", id: "ov1", field: "bonus" }]);
  const adjLines = [{ ...lines[0], payableCommission: 11642.38, adjusted: true }];
  const existingAdj = [{ id: "ad1", batchId: B, agentUsername: A, sourceBlock: "GB:FIN_OVERVIEW" }];
  const r2 = plan({ commission: { "GB:FIN_OVERVIEW": "45118.744" } }, { lines: adjLines, adjustments: existingAdj });
  assert.deepEqual(r2.commission, [{ op: "delete", id: "ad1", block: "GB:FIN_OVERVIEW" }]);
});

test("changing an already-corrected value saves over it (one correction per agent, field and week)", () => {
  const r = plan({ bonus: "2500" }, { current: { ...current, bonus: 0 }, overrides: [{ id: "ov1", batchId: B, agentUsername: A, field: "bonus" }] });
  assert.deepEqual(r.supp.map((o: any) => [o.op, o.field, o.value]), [["save", "bonus", 2500]]);
});

test("another agent's or another week's corrections are never touched", () => {
  const r = plan({ bonus: "15000" }, { current: { ...current, bonus: 0 }, overrides: [{ id: "x", batchId: "other-week", agentUsername: A, field: "bonus" }, { id: "y", batchId: B, agentUsername: "someone-else", field: "bonus" }] });
  assert.equal(r.supp.length, 0, "no matching correction, and the figure equals the calculated one, so there is nothing to do");
});

test("agent names match regardless of case", () => {
  const r = plan({ bonus: "15000" }, { current: { ...current, bonus: 0 }, overrides: [{ id: "ov1", batchId: B, agentUsername: A.toUpperCase(), field: "bonus" }] });
  assert.equal(r.supp[0].id, "ov1");
});

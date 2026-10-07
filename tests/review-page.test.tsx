// Drives the REAL Review & Adjust page in a simulated browser (jsdom): the click path finance will use.
// SYNTHETIC data only. Not part of the website build.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const g: any = globalThis;
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node; g.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
// @ts-ignore
const { default: ReviewAdjustPage } = await import("../src/ReviewAdjustPage.jsx");
// @ts-ignore
import { PARSERS } from "../src/lib/engine-core.js";
// @ts-ignore
import { parseCSV } from "../src/lib/csvparse.js";

const eu = (n: number) => n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function items(agents: Array<{ u: string; tickets: number; totalIn: number; totalOut: number; jp3?: number; commission: number; profit: number }>) {
  const row = (c: string[]) => c.map((x) => `"${x}"`).join(";"), zero = Array(13).fill("0,00");
  const L = [`"Financial Overview report (all players included)."`, row(["Username", "Name", "T", "Tickets Count", "Currency", "Total In", "Total Out", "Open payouts", "J1", "J2", "J3", "C1", "C2", "C3", "Reversal", "Commission", "Taxes", "Profit"]),
    row(["\\__ ROOT", "R", "A", "9", "Total in EUR", ...zero]), row(["    |   ", " ", " ", " ", "NGN", ...zero])];
  for (const a of agents) { L.push(row([`    |__ ${a.u}`, "T", "A", String(a.tickets), "Total in EUR", ...zero])); L.push(row(["    |   |   ", " ", " ", " ", "NGN", eu(a.totalIn), eu(a.totalOut), "0,00", "0,00", "0,00", eu(a.jp3 ?? 0), "0,00", "0,00", "0,00", "0,00", eu(a.commission), "0,00", eu(a.profit)])); }
  return PARSERS.GB(parseCSV(L.join("\n"))).items;
}
const EX = { tickets: 3905, totalIn: 1051900, totalOut: 875194, jp3: 5418, commission: 41017.04, profit: 171288 };
const BATCH = { id: "w1", type: "GB", filename: "week1.csv", items: items([{ u: "0100ab-abn-kubwa", ...EX }, { u: "0100ab-abn-other", ...EX }]), supplemental: [], periodStart: "2026-09-28", periodEnd: "2026-10-04", uploadedAt: "2026-10-06T10:00:00Z" };

const C = { paper: "#000", panel: "#111", ink: "#fff", sub: "#999", line: "#333", amber: "#fa0", brick: "#f00", emerald: "#0f0", railActiveBg: "#ff0", railTextActive: "#000" };
const ui = {
  Panel: ({ title, right, children }: any) => <section data-panel={title}><h2>{title}</h2><div>{right}</div>{children}</section>,
  StatusBadge: ({ children }: any) => <span>{children}</span>, C, serif: {}, mono: {}, nums: {}, naira: (n: number) => `N${Math.round(n || 0).toLocaleString("en-US")}`,
};
const setup = (over: any = {}) => {
  const calls: any = { save: [], revert: [], reviewed: [], rule: [] };
  const props = { ui, batches: [BATCH], rules: undefined, adjustments: [], overrides: [], reviews: [], fortyPercentAgents: new Set(), noSupplementalAgents: new Set(),
    canEdit: true, canManagePlans: true, initialBatchId: "w1",
    onSaveEdits: async (x: any) => { calls.save.push(x); }, onRevert: async (x: any) => { calls.revert.push(x); },
    onSetReviewed: async (...a: any[]) => { calls.reviewed.push(a); }, onStandingRule: async (...a: any[]) => { calls.rule.push(a); }, ...over };
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  return { host, root, calls, props, render: async (p = props) => { await act(async () => { root.render(<ReviewAdjustPage {...p} />); }); } };
};
const text = (host: HTMLElement) => host.textContent || "";
const buttons = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].filter((b) => (b.textContent || "").trim() === label) as HTMLButtonElement[];
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
};
const rowOf = (host: HTMLElement, agent: string) => [...host.querySelectorAll("tr")].find((r) => (r.textContent || "").includes(agent))!;

test("the page shows the week, its agents and what the system calculated for each", async () => {
  const s = setup(); await s.render();
  const t = text(s.host);
  for (const want of ["Review & Adjust", "0100ab-abn-kubwa", "0100ab-abn-other", "Not reviewed yet", "Mark week as reviewed"]) assert.ok(t.includes(want), `missing: ${want}`);
  const kubwa = rowOf(s.host, "kubwa").textContent!;
  for (const n of ["3,905", "N1,051,900", "N45,119", "N15,000", "N10,000", "N4,832"]) assert.ok(kubwa.includes(n), `kubwa row missing ${n}: ${kubwa}`);
  s.root.unmount();
});

test("KUBWA FLOW: open the editor, zero the three payments, refuse without a reason, then save", async () => {
  const s = setup(); await s.render();
  await click(buttons(rowOf(s.host, "kubwa") as any, "Edit")[0]);
  assert.ok(text(s.host).includes("Correct this week's pay"), "editor opens");
  await click(buttons(s.host, "No bonus, palliative or gift this week")[0]);
  const inputs = [...s.host.querySelectorAll("input")].filter((i) => i.getAttribute("type") !== "checkbox") as HTMLInputElement[];
  assert.deepEqual(inputs.filter((i) => ["0"].includes(i.value)).length >= 3, true, "the three fields now read 0");
  await click(buttons(s.host, "Save correction")[0]);
  assert.match(text(s.host), /Please say why/, "no reason -> refused with a clear message");
  assert.equal(s.calls.save.length, 0, "nothing was saved");
  await typeInto(s.host.querySelector("textarea")!, "Company shop: no supplemental pay this week");
  await click(buttons(s.host, "Save correction")[0]);
  assert.equal(s.calls.save.length, 1, "saved once");
  const call = s.calls.save[0];
  assert.equal(call.agent, "0100ab-abn-kubwa"); assert.equal(call.reason, "Company shop: no supplemental pay this week");
  assert.deepEqual(call.plan.supp.map((o: any) => [o.field, o.value]), [["bonus", 0], ["palliative", 0], ["gift", 0]]);
  assert.equal(call.plan.commission.length, 0, "commission untouched");
  assert.ok(!text(s.host).includes("Correct this week's pay"), "editor closes after saving");
  s.root.unmount();
});

test("SPARESHOP FLOW: correcting a commission line saves an adjustment that remembers the sheet value", async () => {
  const s = setup(); await s.render();
  await click(buttons(rowOf(s.host, "other") as any, "Edit")[0]);
  const commissionInput = [...s.host.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === "45118.74" || (i as HTMLInputElement).value === "45118.744") as HTMLInputElement;
  assert.ok(commissionInput, "the commission field is pre-filled with what the system pays");
  await typeInto(commissionInput, "11,642.38");
  await typeInto(s.host.querySelector("textarea")!, "Negotiated rate this week");
  await click(buttons(s.host, "Save correction")[0]);
  assert.deepEqual(s.calls.save[0].plan.commission, [{ op: "save", block: "GB:FIN_OVERVIEW", original: 41017.04, adjusted: 11642.38 }]);
  assert.equal(s.calls.save[0].plan.supp.length, 0);
  s.root.unmount();
});

test("a failed save keeps the editor open and shows the reason (e.g. the migration hasn't been run)", async () => {
  const s = setup({ onSaveEdits: async () => { throw new Error("Review & Adjust needs schema_v12_review_and_overrides.sql to be run in Supabase first. Nothing was saved."); } });
  await s.render();
  await click(buttons(rowOf(s.host, "kubwa") as any, "Edit")[0]);
  await click(buttons(s.host, "No bonus, palliative or gift this week")[0]);
  await typeInto(s.host.querySelector("textarea")!, "x");
  await click(buttons(s.host, "Save correction")[0]);
  assert.ok(text(s.host).includes("schema_v12_review_and_overrides.sql"), "the error is shown");
  assert.ok(text(s.host).includes("Correct this week's pay"), "the editor stays open so nothing typed is lost");
  s.root.unmount();
});

test("existing corrections are listed with who/why, shown on the row, and can be undone", async () => {
  const ov = [{ id: "o1", batchId: "w1", agentUsername: "0100ab-abn-kubwa", field: "bonus", originalValue: 15000, overrideValue: 0, reason: "No bonus this week", createdBy: "Finance Ann", createdAt: "2026-10-07T09:00:00Z" }];
  const s = setup({ overrides: ov }); await s.render();
  const t = text(s.host);
  assert.ok(t.includes("Corrections in this week (1)") && t.includes("No bonus this week") && t.includes("Finance Ann"));
  assert.ok(rowOf(s.host, "kubwa").textContent!.includes("Corrected"), "the agent row is flagged");
  assert.ok(rowOf(s.host, "kubwa").textContent!.includes("N0"), "the bonus shows the corrected figure");
  const realConfirm = g.window.confirm; await click(buttons(s.host, "Undo")[0]);
  assert.equal(s.calls.revert.length, 1); assert.equal(s.calls.revert[0].kind, "override"); assert.equal(s.calls.revert[0].row.id, "o1");
  s.root.unmount();
});

test("marking a week reviewed, and reopening it", async () => {
  const s = setup(); await s.render();
  await typeInto(s.host.querySelector("input[placeholder='Optional note']") as HTMLInputElement, "all good");
  await click(buttons(s.host, "Mark week as reviewed")[0]);
  assert.deepEqual(s.calls.reviewed[0], ["w1", true, "all good"]);
  const reviewed = setup({ reviews: [{ batchId: "w1", reviewedBy: "Ann", reviewedAt: "2026-10-07T09:00:00Z", note: "ok" }] }); await reviewed.render();
  assert.ok(text(reviewed.host).includes("Reviewed") && text(reviewed.host).includes("Ann"));
  await click(buttons(reviewed.host, "Reopen for review")[0]);
  assert.deepEqual(reviewed.calls.reviewed[0], ["w1", false, ""]);
  s.root.unmount(); reviewed.root.unmount();
});

test("people who cannot correct pay see the figures but no Edit or review buttons; missing migration is explained", async () => {
  const s = setup({ canEdit: false, reviews: null }); await s.render();
  assert.equal(buttons(s.host, "Edit").length, 0); assert.equal(buttons(s.host, "Mark week as reviewed").length, 0);
  assert.ok(text(s.host).includes("schema_v12_review_and_overrides.sql"));
  s.root.unmount();
});

test("search and 'only corrected' filter the table", async () => {
  const s = setup(); await s.render();
  await typeInto(s.host.querySelector("input[placeholder='Search agent…']") as HTMLInputElement, "other");
  assert.ok(!text(s.host).includes("0100ab-abn-kubwa") && text(s.host).includes("0100ab-abn-other"));
  s.root.unmount();
});

// ------------------------------------------------------------------ sheet vs dashboard
// @ts-ignore
const { default: SheetCheckPanel } = await import("../src/SheetCheckPanel.jsx");
// @ts-ignore
import { compareToSheet } from "../src/lib/sheetCheck.js";
// @ts-ignore
import { aggregateBatches } from "../src/lib/engine-core.js";

// kubwa: the sheet PRINTED no bonus/palliative/gift; "other" agrees with the dashboard.
const SHEET_BATCH = { ...BATCH, id: "w2", filename: "week2.csv", sheetFigures: [
  { agentUsername: "0100ab-abn-kubwa", commission: 45118.744, bonus: 0, palliative: 0, gift: 0, totalEarnings: 45118.744 },
  { agentUsername: "0100ab-abn-other", commission: 45118.744, bonus: 15000, palliative: 10000, gift: 4832.056, totalEarnings: 74950.8 },
] };

test("a week with sheet figures shows who agrees and who differs, and the headline count", async () => {
  const s = setup({ batches: [SHEET_BATCH], initialBatchId: "w2" }); await s.render();
  const kubwa = rowOf(s.host, "kubwa").textContent!, other = rowOf(s.host, "other").textContent!;
  assert.ok(kubwa.includes("Differs") && kubwa.includes("N29,832"), `kubwa row: ${kubwa}`);   // 15,000 + 10,000 + 4,832 more than the sheet
  assert.ok(other.includes("Matches"));
  assert.ok(text(s.host).includes("1 of 2") && text(s.host).includes("1 differ"), "headline: 1 of 2 agree, 1 differs");
  assert.ok(text(s.host).includes("Sheet vs dashboard, week by week"), "history panel is present");
  s.root.unmount();
});

test("'Only differences from the sheet' narrows the table to the agents that need a look", async () => {
  const s = setup({ batches: [SHEET_BATCH], initialBatchId: "w2" }); await s.render();
  const box = [...s.host.querySelectorAll("label")].find((l) => (l.textContent || "").includes("Only differences from the sheet"))!.querySelector("input")!;
  await click(box);
  assert.ok(rowOf(s.host, "0100ab-abn-kubwa"), "the differing agent stays");
  assert.equal(rowOf(s.host, "0100ab-abn-other"), undefined, "the agent that agrees is hidden");
  s.root.unmount();
});

test("KUBWA, SHEET-FIRST: the editor shows what the sheet printed, and one click adopts it", async () => {
  const s = setup({ batches: [SHEET_BATCH], initialBatchId: "w2" }); await s.render();
  await click(buttons(rowOf(s.host, "kubwa") as any, "Edit")[0]);
  assert.ok(text(s.host).includes("The sheet printed") && text(s.host).includes("Bonus N0"), "the sheet's own figures are shown");
  await click(buttons(s.host, "Use the sheet's figures")[0]);
  await typeInto(s.host.querySelector("textarea")!, "Following the sheet this week");
  await click(buttons(s.host, "Save correction")[0]);
  const plan = s.calls.save[0].plan;
  assert.deepEqual(plan.supp.map((o: any) => [o.field, o.value]), [["bonus", 0], ["palliative", 0], ["gift", 0]]);
  assert.equal(plan.commission.length, 0, "the sheet's commission equals the dashboard's, so nothing to change there");
  s.root.unmount();
});

test("an agent that already matches the sheet gets no 'Use the sheet's figures' button", async () => {
  const s = setup({ batches: [SHEET_BATCH], initialBatchId: "w2" }); await s.render();
  await click(buttons(rowOf(s.host, "other") as any, "Edit")[0]);
  assert.ok(text(s.host).includes("The sheet printed")); assert.equal(buttons(s.host, "Use the sheet's figures").length, 0);
  s.root.unmount();
});

test("once the dashboard is corrected to the sheet, the week reads as in agreement again", async () => {
  const ovs = ["bonus", "palliative", "gift"].map((f) => ({ id: f, batchId: "w2", agentUsername: "0100ab-abn-kubwa", field: f, originalValue: 1, overrideValue: 0, reason: "r", createdBy: "x", createdAt: "2026-10-07T00:00:00Z" }));
  const s = setup({ batches: [SHEET_BATCH], initialBatchId: "w2", overrides: ovs }); await s.render();
  assert.ok(text(s.host).includes("2 of 2"), "both agents now agree"); assert.ok(rowOf(s.host, "kubwa").textContent!.includes("Matches"));
  s.root.unmount();
});

test("the upload preview panel lists exactly the agents that differ, with the sheet's and the dashboard's numbers", async () => {
  const forty = new Set<string>(), noSupp = new Set<string>();
  const check = { filename: "week2.csv", ...compareToSheet({ sheetFigures: SHEET_BATCH.sheetFigures, agents: aggregateBatches([SHEET_BATCH], undefined, [], forty, noSupp).agents, fortyPercentAgents: forty, noSupplementalAgents: noSupp }) };
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => { root.render(<SheetCheckPanel ui={ui} checks={[check]} />); });
  const t = text(host);
  assert.ok(t.includes("Check against the sheet") && t.includes("1 of 2 differ") && t.includes("0100ab-abn-kubwa"));
  assert.ok(t.includes("Bonus N0") && t.includes("Bonus N15,000"), "sheet vs dashboard numbers are both shown");
  assert.ok(!t.includes("0100ab-abn-other"), "agents that agree are not listed");
  root.unmount();
  const clean = document.createElement("div"); document.body.appendChild(clean); const r2 = createRoot(clean);
  await act(async () => { r2.render(<SheetCheckPanel ui={ui} checks={[{ filename: "ok.csv", ...compareToSheet({ sheetFigures: [SHEET_BATCH.sheetFigures[1]], agents: aggregateBatches([SHEET_BATCH], undefined, [], forty, noSupp).agents }) }]} />); });
  assert.ok(text(clean).includes("All 1 agents agree")); r2.unmount();
  const none = document.createElement("div"); const r3 = createRoot(none); await act(async () => { r3.render(<SheetCheckPanel ui={ui} checks={[]} />); }); assert.equal(text(none), "", "nothing to show when no sheet was uploaded"); r3.unmount();
});

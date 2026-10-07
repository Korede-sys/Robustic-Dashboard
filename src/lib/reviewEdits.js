// Review & Adjust: turns what a person typed into the exact set of database operations -- and nothing more.
// Kept free of React and Supabase so every rule can be tested offline.
//
// Two kinds of correction, both for ONE agent in ONE uploaded week, both needing a reason:
//   * commission, per source line  -> the existing manual_adjustments (an "adjustment")
//   * bonus / palliative / gift     -> row_overrides (an "override")
// Typing back the system's own calculated value is not an edit: it REMOVES an existing correction, so a
// person can always return to the calculated figure instead of leaving a redundant override behind.

export const EPS = 0.005;
export const SUPP_FIELDS = ["bonus", "palliative", "gift"];

// "1,234.50" and "1234.5" both work; blanks, text and negatives do not.
export function parseAmount(v) {
  const s = String(v ?? "").replace(/[,\s₦]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const lc = (s) => String(s || "").toLowerCase();
const same = (a, b) => Math.abs((a || 0) - (b || 0)) < EPS;

// current / base: the agent as the engine sees it WITH and WITHOUT corrections (base = what the system calculates).
// lines / baseLines: the engine's per-line view (opts.lines) for the same two situations.
export function planEdits({ batchId, agent, current, base, lines, baseLines, form, adjustments, overrides }) {
  const ops = { commission: [], supp: [] };
  const fail = (error) => ({ ok: false, error, ...ops, changed: false });
  const myLines = lines.filter((l) => lc(l.agent) === lc(agent) && l.batchId === batchId);

  for (const l of myLines) {
    const raw = form.commission?.[l.block];
    if (raw === undefined) continue;
    const input = parseAmount(raw);
    if (input === null) return fail(`Commission for ${l.block} must be a number of 0 or more.`);
    if (same(input, l.payableCommission)) continue;
    const baseLine = baseLines.find((b) => lc(b.agent) === lc(agent) && b.batchId === batchId && b.block === l.block);
    const existing = adjustments.find((a) => a.batchId === batchId && lc(a.agentUsername) === lc(agent) && a.sourceBlock === l.block);
    if (baseLine && same(input, baseLine.payableCommission)) { if (existing) ops.commission.push({ op: "delete", id: existing.id, block: l.block }); continue; }
    ops.commission.push({ op: "save", block: l.block, original: l.sheetCommission, adjusted: input });
  }

  for (const f of SUPP_FIELDS) {
    const raw = form[f];
    if (raw === undefined) continue;
    const input = parseAmount(raw);
    if (input === null) return fail(`${f[0].toUpperCase() + f.slice(1)} must be a number of 0 or more.`);
    if (same(input, current[f])) continue;
    const existing = overrides.find((o) => o.batchId === batchId && lc(o.agentUsername) === lc(agent) && o.field === f);
    if (same(input, base[f])) { if (existing) ops.supp.push({ op: "delete", id: existing.id, field: f }); continue; }
    ops.supp.push({ op: "save", field: f, original: base[f], value: input });
  }

  const changed = ops.commission.length + ops.supp.length > 0;
  if (changed && !String(form.reason || "").trim()) return { ok: false, error: "Please say why — the reason is kept with the correction.", ...ops, changed };
  return { ok: true, ...ops, changed };
}

// A short sentence for the activity log / edits list.
export function describeOp(op) {
  if (op.op === "delete") return op.field ? `restored the calculated ${op.field}` : `restored the sheet commission for ${op.block}`;
  return op.field ? `${op.field} set to ${op.value} (calculated ${Math.round((op.original || 0) * 100) / 100})` : `commission for ${op.block} set to ${op.adjusted} (sheet ${op.original})`;
}

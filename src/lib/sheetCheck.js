// Sheet vs dashboard: for one uploaded week, compare what the weekly sheet PRINTED for each agent's pay with what the
// dashboard CALCULATES, and explain each difference. Pure functions; no React, no Supabase.
//
// Why it exists: pay is made from the sheet today, and may move to the dashboard later. A week where the two agree
// is evidence the dashboard can be trusted; a difference is either a sheet error (a formula that skips a row) or a
// rule the dashboard does not know about. Either way someone should look before money moves.
//
// Each agent lands in exactly one state:
//   match       the sheet and the dashboard agree on commission, bonus, palliative, gift and total
//   corrected   they differ, and a person has deliberately corrected this agent in Review & Adjust
//   explained   they differ for a known, deliberate reason (online agent, 40% plan, no-bonus plan)
//   differs     they differ and nothing known explains it  <-- the ones to look at
//   not-counted the sheet lists the agent but the dashboard does not count that row at all

export const CHECK_FIELDS = ["commission", "bonus", "palliative", "gift", "total"];
export const TOLERANCE = 0.5;   // naira; the sheet prints fractions, the comparison should not trip on rounding

const lc = (s) => String(s || "").toLowerCase();
const n = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 0 : Number(v));
const STATE_ORDER = { differs: 0, "not-counted": 1, corrected: 2, explained: 3, match: 4 };

// agents: the engine's agents for THIS week alone (with any corrections applied).
export function compareToSheet({ sheetFigures, agents, fortyPercentAgents = new Set(), noSupplementalAgents = new Set(), tolerance = TOLERANCE }) {
  const byAgent = new Map((agents || []).map((a) => [lc(a.username), a]));
  const rows = [];
  for (const sf of sheetFigures || []) {
    const key = lc(sf.agentUsername);
    const sheet = { commission: n(sf.commission), bonus: n(sf.bonus), palliative: n(sf.palliative), gift: n(sf.gift), total: n(sf.totalEarnings) };
    const a = byAgent.get(key);
    if (!a) { rows.push({ agent: sf.agentUsername, state: "not-counted", reasons: ["The dashboard does not count this row"], sheet, dashboard: null, diff: null, fields: [] }); continue; }
    const dashboard = { commission: a.sourceCommission, bonus: a.bonus, palliative: a.palliative, gift: a.gift, total: a.sourceCommission + a.bonus + a.palliative + a.gift };
    const diff = {}; const fields = [];
    for (const f of CHECK_FIELDS) { diff[f] = dashboard[f] - sheet[f]; if (Math.abs(diff[f]) > tolerance) fields.push(f); }
    let state = "match"; const reasons = [];
    if (fields.length) {
      const online = a.channel === "online", forty = fortyPercentAgents.has(key), noSupp = noSupplementalAgents.has(key);
      const corrected = a.hasEdit || a.hasAdjustment;
      // which differing fields a known rule accounts for
      const covered = new Set();
      if (online) { CHECK_FIELDS.forEach((f) => covered.add(f)); reasons.push("Online agent: never paid by the dashboard"); }
      if (forty) { CHECK_FIELDS.forEach((f) => covered.add(f)); reasons.push("On the 40%-of-profit plan: commission is 40% of profit and there is no bonus"); }
      if (noSupp) { ["bonus", "palliative", "gift", "total"].forEach((f) => covered.add(f)); reasons.push("On the no-bonus plan: no bonus, palliative or gift"); }
      if (corrected) { state = "corrected"; reasons.unshift("A person corrected this agent in Review & Adjust"); }
      else if (fields.every((f) => covered.has(f))) state = "explained";
      else state = "differs";
    }
    rows.push({ agent: sf.agentUsername, state, reasons, sheet, dashboard, diff, fields });
  }
  // Worst first. Size of a difference = the larger of the total's gap and the sum of the component gaps, so a sheet whose
  // printed total disagrees with its own components still sorts sensibly.
  const size = (r) => !r.diff ? 0 : Math.max(Math.abs(r.diff.total), ["commission", "bonus", "palliative", "gift"].reduce((t, f) => t + Math.abs(r.diff[f]), 0));
  rows.sort((x, y) => STATE_ORDER[x.state] - STATE_ORDER[y.state] || size(y) - size(x));
  const counts = { match: 0, explained: 0, corrected: 0, differs: 0, "not-counted": 0 };
  for (const r of rows) counts[r.state]++;
  return { rows, counts, compared: rows.length, agree: counts.match + counts.explained + counts.corrected, unexplained: counts.differs };
}

export const STATE_LABEL = { match: "Matches", explained: "Differs (known rule)", corrected: "Corrected", differs: "Differs", "not-counted": "Not counted" };

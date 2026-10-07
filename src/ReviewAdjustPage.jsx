import React, { useMemo, useState } from "react";
import { aggregateBatches } from "./lib/engine-core";
import { planEdits, SUPP_FIELDS } from "./lib/reviewEdits";
import { compareToSheet, STATE_LABEL } from "./lib/sheetCheck";

// Finance -> Review & Adjust: the step between uploading a week and exporting it.
//
// Nothing here edits the uploaded file. A correction is saved BESIDE it, with a reason, the calculated figure it
// replaced, who made it and when -- and removing it restores the calculated figure. Commission corrections are
// the existing manual adjustments; Bonus / Palliative / Gift corrections are row overrides. Both apply to ONE
// agent in ONE week, so fixing a negotiated case (e.g. no bonus for a company shop this week, or a one-off
// commission rate) never changes any other week or any other agent.
const TYPE_LABELS = { GB: "Globalbet", EB: "Elbet", EB_MB: "Elbet monthly bonus", SP: "Sports", SP_MB: "Sports monthly bonus", XP: "Xpool" };
const FIELD_LABELS = { bonus: "Bonus", palliative: "Palliative", gift: "Gift" };
const r2 = (n) => Math.round((n || 0) * 100) / 100;

export default function ReviewAdjustPage({
  ui, batches, rules, adjustments, overrides, reviews, fortyPercentAgents, noSupplementalAgents,
  canEdit, canManagePlans, initialBatchId, onSaveEdits, onRevert, onSetReviewed, onStandingRule,
}) {
  const { Panel, StatusBadge, C, serif, mono, nums, naira } = ui;
  const sorted = useMemo(() => [...batches].sort((a, b) => String(b.periodStart || b.uploadedAt).localeCompare(String(a.periodStart || a.uploadedAt))), [batches]);
  const [batchId, setBatchId] = useState(initialBatchId && batches.some(b => b.id === initialBatchId) ? initialBatchId : (sorted[0] && sorted[0].id) || null);
  const [search, setSearch] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const [editing, setEditing] = useState(null);       // agent username being edited
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  const batch = batches.find(b => b.id === batchId) || null;
  const current = useMemo(() => batch ? aggregateBatches([batch], rules, adjustments, fortyPercentAgents, noSupplementalAgents, overrides, { lines: true }) : null,
    [batch, rules, adjustments, overrides, fortyPercentAgents, noSupplementalAgents]);
  // The same week with NO corrections: what the system itself calculates. Used to remember "what it was" and to
  // recognise when a person types the calculated value back (which removes the correction instead of stacking one).
  const base = useMemo(() => batch ? aggregateBatches([batch], rules, [], fortyPercentAgents, noSupplementalAgents, [], { lines: true }) : null,
    [batch, rules, fortyPercentAgents, noSupplementalAgents]);

  // Sheet vs dashboard for this week: what the sheet PRINTED against what the dashboard now calculates (corrections included).
  const check = useMemo(() => (batch && current && batch.sheetFigures && batch.sheetFigures.length)
    ? compareToSheet({ sheetFigures: batch.sheetFigures, agents: current.agents, fortyPercentAgents, noSupplementalAgents }) : null,
    [batch, current, fortyPercentAgents, noSupplementalAgents]);
  const checkByAgent = useMemo(() => new Map((check ? check.rows : []).map(r => [r.agent.toLowerCase(), r])), [check]);
  // Every week that has sheet figures, side by side: the evidence for (or against) paying from the dashboard.
  const history = useMemo(() => [...batches].filter(b => b.sheetFigures && b.sheetFigures.length)
    .sort((a, b) => String(b.periodStart || b.uploadedAt).localeCompare(String(a.periodStart || a.uploadedAt)))
    .map(b => ({ batch: b, ...compareToSheet({ sheetFigures: b.sheetFigures, agents: aggregateBatches([b], rules, adjustments, fortyPercentAgents, noSupplementalAgents, overrides).agents, fortyPercentAgents, noSupplementalAgents }) })),
    [batches, rules, adjustments, overrides, fortyPercentAgents, noSupplementalAgents]);

  const review = reviews ? reviews.find(r => r.batchId === batchId) : null;
  const myAdjustments = adjustments.filter(a => a.batchId === batchId);
  const myOverrides = overrides.filter(o => o.batchId === batchId);
  const fmt = (iso) => iso ? new Date(iso).toLocaleString() : "—";

  if (!batches.length) return (
    <Panel title="Review & Adjust"><div style={{ fontSize: 13, color: C.sub }}>Nothing to review yet. Upload a week in Upload &amp; Process, then come back here before exporting.</div></Panel>
  );

  const rows = (current ? current.agents : []).filter(a => !search || a.username.toLowerCase().includes(search.toLowerCase())).filter(a => !onlyEdited || a.hasEdit || a.hasAdjustment)
    .filter(a => !onlyDiffs || (checkByAgent.get(a.username.toLowerCase()) || {}).state === "differs");
  const totals = current ? current.agents.reduce((t, a) => ({ commission: t.commission + a.sourceCommission, bonus: t.bonus + a.bonus, palliative: t.palliative + a.palliative, gift: t.gift + a.gift }), { commission: 0, bonus: 0, palliative: 0, gift: 0 }) : null;
  const agentOf = (res, u) => res && res.agents.find(a => a.username.toLowerCase() === String(u).toLowerCase());

  function openEdit(a) {
    const lines = current.lines.filter(l => l.agent.toLowerCase() === a.username.toLowerCase());
    setForm({
      bonus: String(r2(a.bonus)), palliative: String(r2(a.palliative)), gift: String(r2(a.gift)), reason: "",
      commission: Object.fromEntries(lines.map(l => [l.block, String(r2(l.payableCommission))])),
    });
    setError(""); setEditing(a.username);
  }
  const editAgent = editing ? agentOf(current, editing) : null;
  const editBase = editing ? agentOf(base, editing) : null;
  const editLines = editing ? current.lines.filter(l => l.agent.toLowerCase() === editing.toLowerCase()) : [];
  const editSheet = editing ? (checkByAgent.get(editing.toLowerCase()) || null) : null;
  function useSheetFigures() {
    const sh = editSheet.sheet;
    setForm(f => ({
      ...f, bonus: String(r2(sh.bonus)), palliative: String(r2(sh.palliative)), gift: String(r2(sh.gift)),
      // the sheet prints ONE commission figure per agent, so it can only be applied when the agent has a single commission line
      commission: editLines.length === 1 ? { ...f.commission, [editLines[0].block]: String(r2(sh.commission)) } : f.commission,
    }));
  }

  async function save() {
    const plan = planEdits({
      batchId, agent: editing, current: editAgent, base: editBase || { bonus: 0, palliative: 0, gift: 0 },
      lines: current.lines, baseLines: base.lines, form, adjustments, overrides,
    });
    if (!plan.ok) { setError(plan.error); return; }
    if (!plan.changed) { setEditing(null); return; }
    setBusy(true); setError("");
    try { await onSaveEdits({ batch, agent: editing, plan, reason: form.reason.trim() }); setEditing(null); }
    catch (e) { setError(e.message || "Couldn't save."); }
    setBusy(false);
  }
  async function standingRule() {
    if (!window.confirm(`Never pay Bonus, Palliative or Gift to ${editing} in ANY week (a standing "no supplemental pay" rule)? You can undo it later in Payout Rules.`)) return;
    setBusy(true); setError("");
    try { await onStandingRule(editing, (form.reason || "").trim() || "Set from Review & Adjust"); setEditing(null); }
    catch (e) { setError(e.message || "Couldn't save the rule."); }
    setBusy(false);
  }
  async function toggleReviewed() {
    setBusy(true);
    try { await onSetReviewed(batchId, !review, reviewNote.trim()); setReviewNote(""); } catch (e) { window.alert(e.message || "Couldn't update the review status."); }
    setBusy(false);
  }

  const th = { textAlign: "left", padding: "8px 8px", whiteSpace: "nowrap", fontSize: 11.5 };
  const td = { padding: "7px 8px", borderTop: `1px solid ${C.line}`, fontSize: 12.5, whiteSpace: "nowrap" };
  const btn = { border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" };
  const input = { border: `1px solid ${C.line}`, background: C.paper, color: C.ink, borderRadius: 6, padding: "6px 8px", fontSize: 13, width: 130, textAlign: "right" };
  const planBadge = (a) => a.channel === "online" ? <StatusBadge tone="neutral">Online</StatusBadge> : a.onFortyPercentPlan ? <StatusBadge tone="neutral">40% plan</StatusBadge> : a.onNoSupplementalPlan ? <StatusBadge tone="neutral">No-bonus plan</StatusBadge> : null;

  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 4px" }}>Review &amp; Adjust</h1>
        <div style={{ fontSize: 13, color: C.sub, maxWidth: 820, lineHeight: 1.5 }}>
          Check a week before you export it. Corrections are saved <strong>beside</strong> the uploaded file with a reason, never over it, apply to one agent in one week only,
          and can be undone to restore the calculated figure.
        </div>
      </div>

      <Panel title="Week">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select value={batchId || ""} onChange={e => { setBatchId(e.target.value); setEditing(null); }} style={{ ...input, width: "auto", maxWidth: "100%", textAlign: "left" }}>
            {sorted.map(b => {
              const rv = reviews && reviews.some(r => r.batchId === b.id);
              return <option key={b.id} value={b.id}>{TYPE_LABELS[b.type] || b.type} · {b.periodStart ? `${b.periodStart} → ${b.periodEnd}` : "no period"} · {b.filename}{reviews ? (rv ? "  ✓ reviewed" : "  — not reviewed") : ""}</option>;
            })}
          </select>
          {reviews === null ? (
            <span style={{ fontSize: 12, color: C.sub }}>Review tracking isn't set up yet (run schema_v12_review_and_overrides.sql).</span>
          ) : review ? (
            <span style={{ fontSize: 12.5 }}><StatusBadge tone="green">Reviewed</StatusBadge> by {review.reviewedBy} on {fmt(review.reviewedAt)}{review.note ? ` — “${review.note}”` : ""}</span>
          ) : <StatusBadge tone="amber">Not reviewed yet</StatusBadge>}
          {canEdit && reviews !== null && (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              {!review && <input value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Optional note" style={{ ...input, width: 180, textAlign: "left" }} />}
              <button disabled={busy} onClick={toggleReviewed} style={{ ...btn, fontWeight: 600 }}>{review ? "Reopen for review" : "Mark week as reviewed"}</button>
            </span>
          )}
        </div>
        {totals && (
          <div style={{ display: "flex", gap: 22, marginTop: 14, flexWrap: "wrap", fontSize: 12.5 }}>
            {[["Commission", totals.commission], ["Bonus", totals.bonus], ["Palliative", totals.palliative], ["Gift", totals.gift]].map(([l, v]) => (
              <div key={l}><div style={{ color: C.sub, fontSize: 11 }}>{l}</div><div style={{ ...nums, fontWeight: 700, fontSize: 15 }}>{naira(v)}</div></div>
            ))}
            {check ? (
              <div><div style={{ color: C.sub, fontSize: 11 }}>Agree with the sheet</div>
                <div style={{ ...nums, fontWeight: 700, fontSize: 15, color: check.unexplained ? C.amber : C.ink }}>{check.agree} of {check.compared}{check.unexplained ? ` · ${check.unexplained} differ` : ""}</div></div>
            ) : (
              <div style={{ maxWidth: 250 }}><div style={{ color: C.sub, fontSize: 11 }}>Agree with the sheet</div>
                <div style={{ fontSize: 12, color: C.sub }}>No sheet figures stored for this week (needs the weekly sheet uploaded after schema_v13).</div></div>
            )}
            <div><div style={{ color: C.sub, fontSize: 11 }}>Corrections in this week</div><div style={{ ...nums, fontWeight: 700, fontSize: 15 }}>{myAdjustments.length + myOverrides.length}</div></div>
          </div>
        )}
      </Panel>

      <Panel title={`Agents in this week${rows.length ? ` (${rows.length})` : ""}`} right={
        <span style={{ display: "inline-flex", gap: 12, alignItems: "center", fontSize: 12 }}>
          {check && <label style={{ display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={onlyDiffs} onChange={e => setOnlyDiffs(e.target.checked)} /> Only differences from the sheet</label>}
          <label style={{ display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={onlyEdited} onChange={e => setOnlyEdited(e.target.checked)} /> Only corrected</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agent…" style={{ ...input, width: 190, textAlign: "left" }} />
        </span>}>
        <div style={{ maxHeight: 520, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead style={{ position: "sticky", top: 0, background: C.panel }}>
              <tr>{["Agent", "State", "Tickets", "Stake", "Profit", "Commission", "Bonus", "Palliative", "Gift", "Total pay", ...(check ? ["Sheet"] : []), "Notes", ""].map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 2 && i <= 9 ? "right" : "left" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.username}>
                  <td style={{ ...td, ...mono, fontSize: 12 }}>{a.username}</td>
                  <td style={td}>{a.state || "—"}</td>
                  <td style={{ ...td, ...nums, textAlign: "right" }}>{a.tickets.toLocaleString()}</td>
                  <td style={{ ...td, ...nums, textAlign: "right" }}>{naira(a.stake)}</td>
                  <td style={{ ...td, ...nums, textAlign: "right" }}>{naira(a.profit)}</td>
                  <td style={{ ...td, ...nums, textAlign: "right" }}>{naira(a.sourceCommission)}</td>
                  {SUPP_FIELDS.map(f => <td key={f} style={{ ...td, ...nums, textAlign: "right", fontWeight: a.editedFields.includes(f) ? 700 : 400, color: a.editedFields.includes(f) ? C.amber : C.ink }}>{naira(a[f])}</td>)}
                  <td style={{ ...td, ...nums, textAlign: "right", fontWeight: 700 }}>{naira(a.sourceCommission + a.monthlyBonus)}</td>
                  {check && (() => {
                    const c = checkByAgent.get(a.username.toLowerCase());
                    if (!c) return <td style={{ ...td, color: C.sub }}>—</td>;
                    return <td style={td} title={c.reasons.join(" · ")}>
                      {c.state === "match" ? <StatusBadge tone="green">Matches</StatusBadge>
                        : c.state === "differs" ? <StatusBadge tone="amber">Differs {naira(Math.abs(c.diff.total))}</StatusBadge>
                        : <StatusBadge tone="neutral">{STATE_LABEL[c.state]}</StatusBadge>}
                    </td>;
                  })()}
                  <td style={td}>
                    {(a.hasEdit || a.hasAdjustment) && <StatusBadge tone="amber">Corrected</StatusBadge>} {planBadge(a)}
                  </td>
                  <td style={td}>{canEdit && <button style={btn} onClick={() => openEdit(a)}>Edit</button>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={13} style={{ ...td, color: C.sub }}>No agents match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: C.sub, marginTop: 10, lineHeight: 1.5 }}>
          Figures are what the system calculates from the uploaded file, plus any corrections below. If the <em>sheet itself</em> is wrong (a wrong stake or ticket count), fix it at the source and upload it again;
          this page corrects what is <em>paid</em>, not the underlying numbers.
        </div>
      </Panel>

      <Panel title={`Corrections in this week (${myAdjustments.length + myOverrides.length})`}>
        {myAdjustments.length + myOverrides.length === 0 ? (
          <div style={{ fontSize: 13, color: C.sub }}>None. Every figure above is exactly what the system calculated.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Agent", "What", "Calculated / sheet", "Now", "Reason", "By", "When", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {myAdjustments.map(a => (
                <tr key={a.id}>
                  <td style={{ ...td, ...mono, fontSize: 12 }}>{a.agentUsername}</td><td style={td}>Commission · {a.sourceBlock}</td>
                  <td style={{ ...td, ...nums }}>{a.originalCommission == null ? "—" : naira(a.originalCommission)}</td><td style={{ ...td, ...nums, fontWeight: 700 }}>{naira(a.adjustedCommission)}</td>
                  <td style={{ ...td, whiteSpace: "normal", minWidth: 180 }}>{a.reason}</td><td style={td}>{a.createdBy}</td><td style={td}>{fmt(a.createdAt)}</td>
                  <td style={td}>{canEdit && <button style={btn} onClick={() => onRevert({ kind: "adjustment", row: a })}>Undo</button>}</td>
                </tr>
              ))}
              {myOverrides.map(o => (
                <tr key={o.id}>
                  <td style={{ ...td, ...mono, fontSize: 12 }}>{o.agentUsername}</td><td style={td}>{FIELD_LABELS[o.field]}</td>
                  <td style={{ ...td, ...nums }}>{o.originalValue == null ? "—" : naira(o.originalValue)}</td><td style={{ ...td, ...nums, fontWeight: 700 }}>{naira(o.overrideValue)}</td>
                  <td style={{ ...td, whiteSpace: "normal", minWidth: 180 }}>{o.reason}</td><td style={td}>{o.createdBy}</td><td style={td}>{fmt(o.createdAt)}</td>
                  <td style={td}>{canEdit && <button style={btn} onClick={() => onRevert({ kind: "override", row: o })}>Undo</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {history.length > 0 && (
        <Panel title="Sheet vs dashboard, week by week">
          <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5, marginBottom: 10, maxWidth: 760 }}>
            If the dashboard keeps giving the same answer as your sheet, week after week, it is safe to pay from it. Any week with unexplained differences is a reason to wait.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Week", "Agents compared", "Match", "Known rule / corrected", "Unexplained differences", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {history.map(h => (
                <tr key={h.batch.id}>
                  <td style={td}>{h.batch.periodStart ? `${h.batch.periodStart} → ${h.batch.periodEnd}` : h.batch.filename}</td>
                  <td style={{ ...td, ...nums }}>{h.compared}</td><td style={{ ...td, ...nums }}>{h.counts.match}</td>
                  <td style={{ ...td, ...nums }}>{h.counts.explained + h.counts.corrected}</td>
                  <td style={td}>{h.unexplained === 0 ? <StatusBadge tone="green">None</StatusBadge> : <StatusBadge tone="amber">{h.unexplained}</StatusBadge>}</td>
                  <td style={td}><button style={btn} onClick={() => { setBatchId(h.batch.id); setEditing(null); window.scrollTo && window.scrollTo(0, 0); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {editing && editAgent && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => !busy && setEditing(null)}>
          <div style={{ background: C.panel, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 12, width: "min(640px, 100%)", maxHeight: "92vh", overflow: "auto", padding: 22 }} onClick={e => e.stopPropagation()}>
            <div style={{ ...serif, fontSize: 20, marginBottom: 2 }}>Correct this week's pay</div>
            <div style={{ ...mono, fontSize: 12.5, color: C.sub, marginBottom: 14 }}>{editing} · {batch.periodStart ? `${batch.periodStart} → ${batch.periodEnd}` : batch.filename}</div>

            {editSheet && (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>The sheet printed <StatusBadge tone={editSheet.state === "match" ? "green" : editSheet.state === "differs" ? "amber" : "neutral"}>{STATE_LABEL[editSheet.state]}</StatusBadge></div>
                <span style={nums}>Commission {naira(editSheet.sheet.commission)} · Bonus {naira(editSheet.sheet.bonus)} · Palliative {naira(editSheet.sheet.palliative)} · Gift {naira(editSheet.sheet.gift)} · Total {naira(editSheet.sheet.total)}</span>
                {editSheet.reasons.length > 0 && <div style={{ color: C.sub }}>{editSheet.reasons.join(" · ")}</div>}
                {editSheet.state !== "match" && <div style={{ marginTop: 6 }}><button style={btn} onClick={useSheetFigures}>Use the sheet's figures</button></div>}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Commission, by source line</div>
            {editLines.map(l => (
              <div key={l.block} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 12.5 }}>
                <span><span style={mono}>{l.block}</span> <span style={{ color: C.sub }}>· sheet {naira(l.sheetCommission)}</span></span>
                <input style={input} value={form.commission[l.block] ?? ""} onChange={e => setForm(f => ({ ...f, commission: { ...f.commission, [l.block]: e.target.value } }))} />
              </div>
            ))}

            <div style={{ fontWeight: 700, fontSize: 12.5, margin: "14px 0 6px" }}>Bonus, Palliative and Gift</div>
            {SUPP_FIELDS.map(f => (
              <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 12.5 }}>
                <span>{FIELD_LABELS[f]} <span style={{ color: C.sub }}>· calculated {naira(editBase ? editBase[f] : 0)}</span></span>
                <input style={input} value={form[f] ?? ""} onChange={e => setForm(x => ({ ...x, [f]: e.target.value }))} />
              </div>
            ))}
            <button style={{ ...btn, marginTop: 4 }} onClick={() => setForm(x => ({ ...x, bonus: "0", palliative: "0", gift: "0" }))}>No bonus, palliative or gift this week</button>

            <div style={{ fontWeight: 700, fontSize: 12.5, margin: "16px 0 6px" }}>Reason (kept with the correction)</div>
            <textarea value={form.reason} onChange={e => setForm(x => ({ ...x, reason: e.target.value }))} rows={2} placeholder="e.g. Negotiated 55% of base commission this week"
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, background: C.paper, color: C.ink, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: "inherit" }} />

            {error && <div style={{ color: C.brick, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <span>{canManagePlans && !editAgent.onNoSupplementalPlan && !editAgent.onFortyPercentPlan && (
                <button disabled={busy} style={btn} onClick={standingRule} title="A standing rule for every week, not a one-off correction">Make “no bonus” a standing rule…</button>)}</span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button disabled={busy} style={btn} onClick={() => setEditing(null)}>Cancel</button>
                <button disabled={busy} style={{ ...btn, background: C.railActiveBg, color: C.railTextActive, borderColor: C.railActiveBg, fontWeight: 700 }} onClick={save}>{busy ? "Saving…" : "Save correction"}</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

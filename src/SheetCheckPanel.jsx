import React from "react";
import { STATE_LABEL } from "./lib/sheetCheck";

// Shown in the upload preview, BEFORE anything is saved: for each weekly sheet, how many agents' pay the sheet and the
// dashboard agree on, and exactly where they don't. `checks` come from compareToSheet (one per sheet file).
const FIELD_LABEL = { commission: "Commission", bonus: "Bonus", palliative: "Palliative", gift: "Gift", total: "Total" };

export default function SheetCheckPanel({ ui, checks }) {
  const { Panel, StatusBadge, C, mono, nums, naira } = ui;
  if (!checks || checks.length === 0) return null;
  const th = { textAlign: "left", padding: "6px 8px", fontSize: 11.5, whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", borderTop: `1px solid ${C.line}`, fontSize: 12.5, whiteSpace: "nowrap" };
  return (
    <Panel title="Check against the sheet">
      <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5, marginBottom: 12, maxWidth: 780 }}>
        The sheet printed each agent's pay, and the dashboard calculated it independently. Where they differ, one of them is wrong or a rule is missing — decide which
        <strong> before</strong> paying. You can align the dashboard to the sheet afterwards in Review &amp; Adjust.
      </div>
      {checks.map((c) => {
        const bad = c.rows.filter((r) => r.state === "differs" || r.state === "not-counted");
        return (
          <div key={c.filename} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ ...mono, fontSize: 12 }}>{c.filename}</span>
              {c.unexplained === 0 ? <StatusBadge tone="green">All {c.compared} agents agree</StatusBadge>
                : <StatusBadge tone="amber">{c.unexplained} of {c.compared} differ</StatusBadge>}
              <span style={{ fontSize: 12, color: C.sub }}>
                {c.counts.match} match{c.counts.explained ? ` · ${c.counts.explained} differ for a known rule` : ""}{c.counts.corrected ? ` · ${c.counts.corrected} corrected` : ""}
              </span>
            </div>
            {bad.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                  <thead><tr>{["Agent", "Status", "Differs on", "Sheet printed", "Dashboard calculated"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {bad.slice(0, 40).map((r) => (
                      <tr key={r.agent}>
                        <td style={{ ...td, ...mono, fontSize: 12 }}>{r.agent}</td>
                        <td style={td}><StatusBadge tone="amber">{STATE_LABEL[r.state]}</StatusBadge></td>
                        <td style={td}>{r.fields.map((f) => FIELD_LABEL[f]).join(", ") || "—"}</td>
                        <td style={{ ...td, ...nums, whiteSpace: "normal" }}>{r.fields.map((f) => `${FIELD_LABEL[f]} ${naira(r.sheet[f])}`).join(" · ")}</td>
                        <td style={{ ...td, ...nums, whiteSpace: "normal", fontWeight: 600 }}>{r.dashboard ? r.fields.map((f) => `${FIELD_LABEL[f]} ${naira(r.dashboard[f])}`).join(" · ") : "not counted"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bad.length > 40 && <div style={{ fontSize: 11.5, color: C.sub, marginTop: 6 }}>…and {bad.length - 40} more.</div>}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

import React, { useEffect, useState } from "react";
import {
  SOURCES, INTEGRATION_TYPES, CAPABILITIES, CSV_CAPABILITIES,
  sourceOfBatch, liveConnectionStatus,
} from "./lib/sources";

// Settings -> Data Sources. Everything shown is derived from real data
// (uploaded batches + recorded sync runs). Two different things are kept apart:
//   * CONNECTORS = how data gets in. Today the only one is the CSV Upload
//     connector (the existing import), which is genuinely working.
//   * BACKOFFICES = the systems the data belongs to. None has a LIVE
//     connection, so each shows "Not Connected" -- a manual upload never
//     counts as a connection. Test Connection / Sync Now / Configure / Disable
//     are disabled with the reason, because no live connector exists yet.
// `ui` carries the app's own Panel/StatusBadge/tokens so this page matches the
// rest of the app without duplicating its styling.
export default function DataSourcesPage({ ui, batches, dataSources, syncRuns, onRefresh, onGoToUpload }) {
  const { Panel, StatusBadge, C, serif, mono, nums } = ui;
  const [openHistory, setOpenHistory] = useState(null);
  useEffect(() => { onRefresh && onRefresh(); }, []);

  const dbById = Object.fromEntries((dataSources || []).map(d => [d.id, d]));
  const fmt = (iso) => iso ? new Date(iso).toLocaleString() : "—";
  const latest = (list) => list.reduce((max, x) => (!max || x > max ? x : max), null);

  const statusTone = { "Connected": "green", "Syncing": "indigo", "Testing": "indigo", "Sync Failed": "red", "Disabled": "neutral", "Requires Configuration": "amber", "Not Connected": "neutral" };

  // CSV connector totals across everything uploaded
  const allRecords = batches.reduce((n, b) => n + b.items.length, 0);
  const lastUploadAll = latest(batches.map(b => b.uploadedAt).filter(Boolean));
  const csvRuns = (syncRuns || []).filter(r => r.mode === "manual");
  const csvFailed = csvRuns.find(r => r.status === "failed");

  const rows = SOURCES.map((def) => {
    const db = dbById[def.id];
    const sourceBatches = batches.filter(b => sourceOfBatch(b) === def.id);
    const recordCount = sourceBatches.reduce((n, b) => n + b.items.length, 0);
    const runs = (syncRuns || []).filter(r => r.source_id === def.id);
    const lastRunOk = runs.find(r => r.status === "succeeded");
    const lastRunFail = runs.find(r => r.status === "failed");
    const lastData = latest([lastRunOk && (lastRunOk.finished_at || lastRunOk.started_at), ...sourceBatches.map(b => b.uploadedAt)].filter(Boolean));
    return {
      def, recordCount, runs, hasData: recordCount > 0,
      status: liveConnectionStatus(runs, db ? db.enabled === false : false),
      lastData,
      lastFail: lastRunFail ? (lastRunFail.finished_at || lastRunFail.started_at) : null,
      error: lastRunFail ? lastRunFail.error_summary : null,
      note: (db && db.status_note) || def.note,
      // Capabilities are only claimed from files actually received; a source
      // with no data has not been assessed, so nothing is claimed for it.
      provides: sourceBatches.length > 0 ? CSV_CAPABILITIES : null,
    };
  });

  const th = { textAlign: "left", padding: "8px 10px", whiteSpace: "nowrap" };
  const td = { padding: "10px", verticalAlign: "top", borderTop: `1px solid ${C.line}`, fontSize: 12.5 };
  const dis = { border: `1px solid ${C.line}`, background: "none", color: C.sub, borderRadius: 7, padding: "5px 10px", fontSize: 11.5, opacity: 0.55, cursor: "not-allowed" };
  const noConn = "Not available yet: no live connector exists for this backoffice.";

  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 4px" }}>Data Sources</h1>
        <div style={{ fontSize: 13, color: C.sub }}>
          Backoffices and the connectors that bring their data in. Today every backoffice is fed by the CSV Upload connector; none has a live connection.
        </div>
      </div>

      <Panel title="Connectors">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>{["Connector", "Status", "Integration", "Last sync", "Records", "Last error"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              <tr>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>CSV Upload connector</div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>The existing Upload &amp; Process import. Verified working.</div>
                </td>
                <td style={td}><StatusBadge tone={allRecords > 0 ? "green" : "neutral"}>{allRecords > 0 ? "Connected" : "Not Connected"}</StatusBadge></td>
                <td style={td}>{INTEGRATION_TYPES.csv_upload}</td>
                <td style={td}>{fmt(lastUploadAll)}</td>
                <td style={{ ...td, ...nums }}>{allRecords.toLocaleString()}</td>
                <td style={td}>{csvFailed ? csvFailed.error_summary : "None recorded"}</td>
              </tr>
              <tr>
                <td style={td}><div style={{ fontWeight: 700 }}>Live backoffice connectors</div></td>
                <td style={td}><StatusBadge tone="neutral">None exist</StatusBadge></td>
                <td style={td}>—</td><td style={td}>—</td><td style={td}>—</td>
                <td style={td}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
        {onGoToUpload && (
          <div style={{ marginTop: 12 }}>
            <button onClick={onGoToUpload} style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Upload files</button>
          </div>
        )}
      </Panel>

      <Panel title="AccessBet integration status">
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <StatusBadge tone="neutral">Not started</StatusBadge>{" "}
          How the AccessBet Agents page loads its data has not been established, so no access method is assumed and nothing is connected.
          Nothing will be marked Connected until real AccessBet data has been retrieved and reconciled against a known report. Credentials are
          never stored in the browser or in this database. See <span style={mono}>docs/ARCHITECTURE_multi_backoffice.md</span>.
        </div>
      </Panel>

      <Panel title={`${rows.length} backoffices`}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr>{["Backoffice", "Live connection", "Integration", "Last sync", "Last failed sync", "Rows in dashboard", "Provides", "Actions", "Last error"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.def.id}>
                  <tr>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{r.def.name}</div>
                      <div style={{ fontSize: 11, color: C.sub, marginTop: 2, maxWidth: 240, lineHeight: 1.4 }}>{r.note}</div>
                    </td>
                    <td style={td}><StatusBadge tone={statusTone[r.status]}>{r.status}</StatusBadge></td>
                    <td style={td}>{r.hasData ? `${INTEGRATION_TYPES.csv_upload} (via CSV connector)` : "—"}</td>
                    <td style={td}>{fmt(r.lastData)}</td>
                    <td style={td}>{fmt(r.lastFail)}</td>
                    <td style={{ ...td, ...nums }}>{r.recordCount.toLocaleString()}</td>
                    <td style={{ ...td, minWidth: 190 }}>
                      {r.provides ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11.5 }}>
                          {CAPABILITIES.map(c => (
                            <span key={c.id} style={{ color: r.provides[c.id] ? C.emerald : C.sub }}>
                              {r.provides[c.id] ? "✓" : "✗"} {c.label}
                            </span>
                          ))}
                        </div>
                      ) : <span style={{ color: C.sub }}>Not assessed</span>}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 230 }}>
                        <button disabled style={dis} title={noConn}>Test Connection</button>
                        <button disabled style={dis} title={noConn}>Sync Now</button>
                        <button disabled style={dis} title="Not available yet: configuration applies to live connectors, and none exists for this backoffice.">Configure</button>
                        <button disabled style={dis} title="Not available yet: nothing live to disable.">Disable</button>
                        <button onClick={() => setOpenHistory(openHistory === r.def.id ? null : r.def.id)}
                          style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>
                          {openHistory === r.def.id ? "Hide history" : "View Sync History"}
                        </button>
                      </div>
                    </td>
                    <td style={td}>{r.error || "None recorded"}</td>
                  </tr>
                  {openHistory === r.def.id && (
                    <tr>
                      <td colSpan={9} style={{ ...td, background: C.paper }}>
                        {r.runs.length === 0 ? (
                          <span style={{ color: C.sub }}>No sync runs recorded for this backoffice. Uploads made before the Data Sources migration was applied are not logged as runs.</span>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead><tr>{["Started", "Mode", "Status", "Retrieved", "Added", "Updated", "Skipped", "Error"].map(h => <th key={h} style={{ ...th, padding: "4px 8px" }}>{h}</th>)}</tr></thead>
                            <tbody>
                              {r.runs.slice(0, 15).map(run => (
                                <tr key={run.id}>
                                  <td style={{ padding: "4px 8px" }}>{fmt(run.started_at)}</td>
                                  <td style={{ padding: "4px 8px" }}>{run.mode}</td>
                                  <td style={{ padding: "4px 8px" }}>{run.status}</td>
                                  <td style={{ padding: "4px 8px", ...nums }}>{run.records_seen ?? "—"}</td>
                                  <td style={{ padding: "4px 8px", ...nums }}>{run.records_inserted ?? "—"}</td>
                                  <td style={{ padding: "4px 8px", ...nums }}>{run.records_updated ?? "—"}</td>
                                  <td style={{ padding: "4px 8px", ...nums }}>{run.records_skipped ?? "—"}</td>
                                  <td style={{ padding: "4px 8px" }}>{run.error_summary || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: C.sub, marginTop: 12, lineHeight: 1.5 }}>
          "Provides" lists only what the files received from that backoffice actually contain: weekly per-agent totals. No file has contained individual
          tickets, transactions, wallets or daily rows, so those reports will stay unavailable until a source supplies that data. Backoffice attribution
          for existing uploads is derived from the file type and can be corrected. Product (Luckyball, Luckygreek, Globalbet Virtual, Sports…) is a
          separate filter on Reports and is not the same thing as a backoffice.
        </div>
      </Panel>
    </>
  );
}

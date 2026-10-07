import React, { useEffect, useState } from "react";
import {
  SOURCES, INTEGRATION_TYPES, CAPABILITIES, CSV_CAPABILITIES,
  sourceOfBatch, liveConnectionStatus,
} from "./lib/sources";

// Settings -> Data Sources: the control centre for the backoffices.
//   * CONNECTORS = how data gets in. The CSV Upload connector is the existing
//     manual import (verified working, kept as the fallback). Live connectors
//     run server-side in the `sync-source` Edge Function.
//   * BACKOFFICES = the systems the data belongs to. Each shows its LIVE
//     connection status, derived only from live sync runs: a manual upload
//     never counts, and Connected requires a live sync that retrieved real data.
// Test Connection / Sync Now are enabled for a backoffice ONLY when the sync
// service is reachable, the signed-in user is admin/finance, AND that
// backoffice's connector is implemented server-side. Credentials are never
// entered or shown here -- they exist only as server-side secrets.
// `ui` carries the app's own Panel/StatusBadge/tokens so this page matches the
// rest of the app without duplicating its styling.
export default function DataSourcesPage({
  ui, batches, dataSources, syncRuns, onRefresh, onGoToUpload,
  connectorInfo, canRun, onTest, onSync,
}) {
  const { Panel, StatusBadge, C, serif, mono, nums } = ui;
  const [openPanel, setOpenPanel] = useState(null); // `${id}:history` | `${id}:assessment` | `${id}:sync`
  const [syncForm, setSyncForm] = useState({ mode: "incremental", from: "", to: "" });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState({});         // per-source result message
  useEffect(() => { onRefresh && onRefresh(); }, []);

  const dbById = Object.fromEntries((dataSources || []).map(d => [d.id, d]));
  const connById = Object.fromEntries(((connectorInfo && connectorInfo.connectors) || []).map(c => [c.id, c]));
  const serviceState = (connectorInfo && connectorInfo.state) || "checking";
  const fmt = (iso) => iso ? new Date(iso).toLocaleString() : "—";
  const latest = (list) => list.reduce((max, x) => (!max || x > max ? x : max), null);
  const statusTone = { "Connected": "green", "Syncing": "indigo", "Testing": "indigo", "Sync Failed": "red", "Disabled": "neutral", "Requires Configuration": "amber", "Not Connected": "neutral" };

  const allRecords = batches.reduce((n, b) => n + b.items.length, 0);
  const lastUploadAll = latest(batches.map(b => b.uploadedAt).filter(Boolean));
  const csvFailed = (syncRuns || []).find(r => r.status === "failed" && (r.via ?? "csv_upload") === "csv_upload");

  const rows = SOURCES.map((def) => {
    const db = dbById[def.id];
    const impl = connById[def.id];
    const implemented = !!impl && impl.status === "implemented";
    const sourceBatches = batches.filter(b => sourceOfBatch(b) === def.id);
    const recordCount = sourceBatches.reduce((n, b) => n + b.items.length, 0);
    const runs = (syncRuns || []).filter(r => r.source_id === def.id);
    const liveRuns = runs.filter(r => (r.via ?? (r.mode === "manual" ? "csv_upload" : "connector")) === "connector");
    const lastRunOk = runs.find(r => r.status === "succeeded" || r.status === "partial");
    const lastRunFail = runs.find(r => r.status === "failed");
    const lastData = latest([lastRunOk && (lastRunOk.finished_at || lastRunOk.started_at), ...sourceBatches.map(b => b.uploadedAt)].filter(Boolean));
    const lastLive = liveRuns[0];
    return {
      def, impl, implemented, recordCount, runs, hasData: recordCount > 0,
      status: liveConnectionStatus(runs, db ? db.enabled === false : false),
      lastData, lastLive,
      lastFail: lastRunFail ? (lastRunFail.finished_at || lastRunFail.started_at) : null,
      error: lastRunFail ? lastRunFail.error_summary : null,
      note: (db && db.status_note) || def.note,
      provides: implemented && impl.capabilities ? impl.capabilities : (sourceBatches.length > 0 ? CSV_CAPABILITIES : null),
      integration: implemented && impl.integrationType ? INTEGRATION_TYPES[impl.integrationType] : (sourceBatches.length > 0 ? `${INTEGRATION_TYPES.csv_upload} (via CSV connector)` : "—"),
    };
  });

  const enabledFor = (r) => canRun && serviceState === "reachable" && r.implemented;
  const whyDisabled = (r) =>
    !canRun ? "Only admin and finance users can run connectors."
    : serviceState !== "reachable" ? "The sync service (Edge Function) isn't deployed or isn't reachable yet."
    : !r.implemented ? "No live connector exists for this backoffice yet: " + ((r.impl && r.impl.assessment.blockers[0]) || "no permitted access method has been established.")
    : "";

  async function doTest(r) {
    setBusy(`${r.def.id}:test`);
    try { const res = await onTest(r.def.id); setNotice(n => ({ ...n, [r.def.id]: `${res.ok ? "OK" : "Not OK"}: ${res.message}` })); }
    catch (e) { setNotice(n => ({ ...n, [r.def.id]: `Test failed: ${e.message}` })); }
    setBusy(null);
  }
  async function doSync(r) {
    setBusy(`${r.def.id}:sync`);
    try {
      const res = await onSync({ source: r.def.id, mode: syncForm.mode, from: syncForm.from || undefined, to: syncForm.to || undefined });
      const c = res.counts || {};
      setNotice(n => ({ ...n, [r.def.id]: `${res.status}: ${res.message}${res.counts ? ` (retrieved ${c.seen}, added ${c.inserted}, updated ${c.updated}, unchanged ${c.unchanged}, removed ${c.removed}, skipped ${c.skipped})` : ""}` }));
    } catch (e) { setNotice(n => ({ ...n, [r.def.id]: `Sync failed: ${e.message}` })); }
    setBusy(null);
  }

  const th = { textAlign: "left", padding: "8px 10px", whiteSpace: "nowrap" };
  const td = { padding: "10px", verticalAlign: "top", borderTop: `1px solid ${C.line}`, fontSize: 12.5 };
  const btn = { border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" };
  const dis = { ...btn, background: "none", color: C.sub, opacity: 0.55, cursor: "not-allowed" };
  const input = { border: `1px solid ${C.line}`, background: C.paper, color: C.ink, borderRadius: 6, padding: "4px 8px", fontSize: 12 };
  const toggle = (key) => setOpenPanel(openPanel === key ? null : key);

  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 4px" }}>Data Sources</h1>
        <div style={{ fontSize: 13, color: C.sub }}>
          Backoffices and the connectors that bring their data in. The CSV Upload connector is always available as the manual fallback.
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
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>The existing Upload &amp; Process import. Verified working; kept as the manual fallback.</div>
                </td>
                <td style={td}><StatusBadge tone={allRecords > 0 ? "green" : "neutral"}>{allRecords > 0 ? "Connected" : "Not Connected"}</StatusBadge></td>
                <td style={td}>{INTEGRATION_TYPES.csv_upload}</td>
                <td style={td}>{fmt(lastUploadAll)}</td>
                <td style={{ ...td, ...nums }}>{allRecords.toLocaleString()}</td>
                <td style={td}>{csvFailed ? csvFailed.error_summary : "None recorded"}</td>
              </tr>
              <tr>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>Sync service (Edge Function)</div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2, maxWidth: 360, lineHeight: 1.4 }}>
                    Runs live connectors server-side. Backoffice credentials exist only as server secrets and never reach this browser.
                  </div>
                </td>
                <td style={td}>
                  <StatusBadge tone={serviceState === "reachable" ? "green" : "neutral"}>
                    {serviceState === "reachable" ? "Reachable" : serviceState === "checking" ? "Checking…" : "Not deployed"}
                  </StatusBadge>
                </td>
                <td style={td}>—</td><td style={td}>—</td><td style={td}>—</td>
                <td style={td}>{serviceState === "unreachable" ? "Not deployed or not reachable. Live sync is unavailable; CSV upload is unaffected." : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {onGoToUpload && (
          <div style={{ marginTop: 12 }}>
            <button onClick={onGoToUpload} style={{ ...btn, padding: "7px 14px", fontSize: 12.5, fontWeight: 600 }}>Upload files</button>
          </div>
        )}
      </Panel>

      <Panel title={`${rows.length} backoffices`}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1240 }}>
            <thead>
              <tr>{["Backoffice", "Live connection", "Integration", "Last successful sync", "Last sync status", "Rows in dashboard", "Provides", "Actions", "Last error"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = r.def.id; const can = enabledFor(r); const why = whyDisabled(r);
                return (
                  <React.Fragment key={id}>
                    <tr>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.def.name}</div>
                        <div style={{ fontSize: 11, color: C.sub, marginTop: 2, maxWidth: 250, lineHeight: 1.4 }}>{r.note}</div>
                        {!r.implemented && r.impl && r.impl.assessment.blockers[0] && (
                          <div style={{ fontSize: 11, color: C.amber, marginTop: 4, maxWidth: 250, lineHeight: 1.4 }}>Blocked: {r.impl.assessment.blockers[0]}</div>
                        )}
                      </td>
                      <td style={td}><StatusBadge tone={statusTone[r.status]}>{r.status}</StatusBadge></td>
                      <td style={td}>{r.integration}</td>
                      <td style={td}>{fmt(r.lastData)}</td>
                      <td style={td}>{r.lastLive ? `${r.lastLive.status} (${fmt(r.lastLive.finished_at || r.lastLive.started_at)})` : "No live sync yet"}</td>
                      <td style={{ ...td, ...nums }}>{r.recordCount.toLocaleString()}</td>
                      <td style={{ ...td, minWidth: 190 }}>
                        {r.provides ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11.5 }}>
                            {CAPABILITIES.map(c => (
                              <span key={c.id} style={{ color: r.provides[c.id] ? C.emerald : C.sub }}>{r.provides[c.id] ? "✓" : "✗"} {c.label}</span>
                            ))}
                          </div>
                        ) : <span style={{ color: C.sub }}>Not assessed</span>}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 260 }}>
                          <button disabled={!can || busy === `${id}:test`} style={can ? btn : dis} title={can ? "Read-only connectivity check. Does not change the connection status." : why} onClick={() => doTest(r)}>{busy === `${id}:test` ? "Testing…" : "Test Connection"}</button>
                          <button disabled={!can} style={can ? btn : dis} title={can ? "Run a synchronization." : why} onClick={() => toggle(`${id}:sync`)}>Sync Now</button>
                          <button disabled style={dis} title="Credentials are set as server-side secrets, never in the dashboard. See docs/ARCHITECTURE_multi_backoffice.md.">Configure</button>
                          <button disabled style={dis} title="Not available yet: nothing live to disable.">Disable</button>
                          <button style={btn} onClick={() => toggle(`${id}:history`)}>{openPanel === `${id}:history` ? "Hide history" : "View Sync History"}</button>
                          {r.impl && <button style={btn} onClick={() => toggle(`${id}:assessment`)}>{openPanel === `${id}:assessment` ? "Hide assessment" : "Assessment"}</button>}
                        </div>
                        {notice[id] && <div style={{ fontSize: 11, color: C.sub, marginTop: 6, maxWidth: 260, lineHeight: 1.4 }}>{notice[id]}</div>}
                      </td>
                      <td style={td}>{r.error || "None recorded"}</td>
                    </tr>
                    {openPanel === `${id}:sync` && can && (
                      <tr><td colSpan={9} style={{ ...td, background: C.paper }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <select value={syncForm.mode} onChange={e => setSyncForm(f => ({ ...f, mode: e.target.value }))} style={input}>
                            <option value="incremental">Incremental (since last sync)</option>
                            <option value="full">Full (re-fetch the window)</option>
                            <option value="manual">Manual window</option>
                          </select>
                          <label style={{ fontSize: 12 }}>From <input type="date" value={syncForm.from} onChange={e => setSyncForm(f => ({ ...f, from: e.target.value }))} style={input} /></label>
                          <label style={{ fontSize: 12 }}>To <input type="date" value={syncForm.to} onChange={e => setSyncForm(f => ({ ...f, to: e.target.value }))} style={input} /></label>
                          <button style={btn} disabled={busy === `${id}:sync`} onClick={() => doSync(r)}>{busy === `${id}:sync` ? "Syncing…" : "Run sync"}</button>
                          <span style={{ fontSize: 11, color: C.sub }}>A period already covered by a manual upload is skipped, never overwritten.</span>
                        </div>
                      </td></tr>
                    )}
                    {openPanel === `${id}:history` && (
                      <tr><td colSpan={9} style={{ ...td, background: C.paper }}>
                        {r.runs.length === 0 ? (
                          <span style={{ color: C.sub }}>No sync runs recorded for this backoffice. Uploads made before the Data Sources migration was applied are not logged as runs.</span>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead><tr>{["Started", "Via", "Mode", "Status", "Retrieved", "Added", "Updated", "Skipped", "Error"].map(h => <th key={h} style={{ ...th, padding: "4px 8px" }}>{h}</th>)}</tr></thead>
                            <tbody>
                              {r.runs.slice(0, 15).map(run => (
                                <tr key={run.id}>
                                  <td style={{ padding: "4px 8px" }}>{fmt(run.started_at)}</td>
                                  <td style={{ padding: "4px 8px" }}>{(run.via ?? (run.mode === "manual" ? "csv_upload" : "connector")) === "connector" ? "Live connector" : "CSV upload"}</td>
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
                      </td></tr>
                    )}
                    {openPanel === `${id}:assessment` && r.impl && (
                      <tr><td colSpan={9} style={{ ...td, background: C.paper }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, fontSize: 12, lineHeight: 1.5 }}>
                          {[["Known", r.impl.assessment.known], ["Not yet established", r.impl.assessment.unknown], ["Blocking a connector", r.impl.assessment.blockers]].map(([title, list]) => (
                            <div key={title}>
                              <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
                              {list.length === 0 ? <span style={{ color: C.sub }}>Nothing recorded.</span> : <ul style={{ margin: 0, paddingLeft: 16 }}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                            </div>
                          ))}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: C.sub, marginTop: 12, lineHeight: 1.5 }}>
          Connected appears only after a live sync has retrieved real data from the backoffice; a manual upload or a successful login alone never shows it.
          "Provides" lists only what a source has actually supplied: files received so far contain weekly per-agent totals, not individual tickets, transactions,
          wallets or daily rows. Product (Luckyball, Luckygreek, Globalbet Virtual, Sports, Xpool…) is a separate filter on Reports and is not a backoffice.
        </div>
      </Panel>
    </>
  );
}

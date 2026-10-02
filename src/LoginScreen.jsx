import React, { useState, useEffect } from "react";
import { Loader2, Moon, Sun } from "lucide-react";
import { signIn } from "./lib/dataLayer";

const C = {
  paper: "var(--paper, #F7F8FA)", panel: "var(--panel, #FFFFFF)", ink: "var(--ink, #0F1222)", sub: "var(--sub, #6B7280)", line: "var(--line, #E6E8EE)",
  emerald: "var(--emerald, #067647)", brick: "var(--brick, #DC2626)", navy: "var(--navy, #4F46E5)",
  railBg: "var(--paper, #F7F8FA)", railText: "var(--sub, #4B5165)", railTextActive: "var(--ink, #0F1222)", stamp: "var(--stamp, #4F46E5)",
};
const THEME_VARS = {
  light: { paper: "#F7F8FA", panel: "#FFFFFF", ink: "#0F1222", sub: "#6B7280", line: "#E6E8EE", emerald: "#067647", brick: "#DC2626", navy: "#4F46E5", stamp: "#4F46E5" },
  dark: { paper: "#120F0A", panel: "#1C1812", ink: "#F2EDE0", sub: "#9C9484", line: "#2E2A1F", emerald: "#34D399", brick: "#F87171", navy: "#F2C230", stamp: "#F2C230" },
};
function themeVarsCSS(vars) { return Object.entries(vars).map(([k, v]) => `--${k}: ${v};`).join(" "); }
const serif = { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif", fontWeight: 800 };
const sans = { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" };

function RobusticMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34">
      <rect x="1" y="1" width="32" height="32" rx="9" fill={C.stamp} />
      <text x="17" y="22.5" textAnchor="middle" fontFamily="'Plus Jakarta Sans', sans-serif" fontSize="14" fontWeight="800" fill="#17130F">A</text>
    </svg>
  );
}

export default function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("robustic-theme") || "light"; } catch (e) { return "light"; }
  });
  useEffect(() => {
    try { localStorage.setItem("robustic-theme", themeMode); } catch (e) { /* non-critical */ }
  }, [themeMode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (err) {
      setError(err.message || "Couldn't sign in -- check your email and password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-theme={themeMode} style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.railBg, position: "relative", ...sans,
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } } .lucide-loader-2 { animation: spin 0.8s linear infinite; }
        :root, [data-theme="light"] { ${themeVarsCSS(THEME_VARS.light)} }
        [data-theme="dark"] { ${themeVarsCSS(THEME_VARS.dark)} }
      `}</style>

      <button onClick={() => setThemeMode(m => m === "light" ? "dark" : "light")} title={themeMode === "light" ? "Switch to dark mode" : "Switch to light mode"} style={{
        position: "absolute", top: 24, right: 28, border: `1px solid ${C.line}`, background: C.panel, color: C.sub,
        cursor: "pointer", padding: 8, borderRadius: 8, display: "flex",
      }}>{themeMode === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, position: "absolute", top: 40 }}>
        <RobusticMark />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
          <div style={{ ...serif, fontSize: 18, fontWeight: 600, color: C.railTextActive }}>AccessBet</div>
          <div style={{ fontSize: 11.5, color: C.railText }}>BDO Reporting</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{
        background: C.panel, border: `1px solid ${C.line}`, padding: "38px 34px", width: 368, boxShadow: "0 12px 32px rgba(15,18,34,0.08)", borderRadius: 12,
      }}>
        <div style={{ ...serif, fontSize: 20, marginBottom: 3, color: C.ink }}>Sign in</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 28 }}>BDO Reporting</div>

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 16, borderRadius: 8, background: C.paper, color: C.ink }}
        />

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 20, borderRadius: 8, background: C.paper, color: C.ink }}
        />

        {error && <div style={{ color: C.brick, fontSize: 12.5, marginBottom: 16 }}>{error}</div>}

        <button type="submit" disabled={loading} style={{
          width: "100%", background: C.navy, color: "#fff", border: "none", padding: "11px 0", borderRadius: 8,
          fontSize: 13.5, fontWeight: 600, cursor: loading ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.7 : 1,
        }}>
          {loading ? <Loader2 size={15} /> : "Sign in"}
        </button>

        <div style={{ fontSize: 11.5, color: C.sub, marginTop: 20, lineHeight: 1.5 }}>
          Don't have an account? Ask your admin to add you from the Team tab, or create the first
          account directly in Supabase Authentication → Users.
        </div>
      </form>
    </div>
  );
}

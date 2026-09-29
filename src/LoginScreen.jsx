import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "./lib/dataLayer";

const C = {
  paper: "#F7F8FA", panel: "#FFFFFF", ink: "#0F1222", sub: "#6B7280", line: "#E6E8EE",
  emerald: "#067647", brick: "#DC2626", navy: "#4F46E5",
  railBg: "#F7F8FA", railText: "#4B5165", railTextActive: "#0F1222", stamp: "#4F46E5",
};
const serif = { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif", fontWeight: 800 };
const sans = { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" };

function RobusticMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34">
      <rect x="1" y="1" width="32" height="32" rx="9" fill={C.stamp} />
      <text x="17" y="22.5" textAnchor="middle" fontFamily="'Plus Jakarta Sans', sans-serif" fontSize="14" fontWeight="800" fill="#fff">R</text>
    </svg>
  );
}

export default function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.railBg, ...sans,
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .lucide-loader-2 { animation: spin 0.8s linear infinite; }`}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, position: "absolute", top: 40 }}>
        <RobusticMark />
        <div style={{ ...serif, fontSize: 20, fontWeight: 600, color: C.railTextActive }}>Robustic</div>
      </div>

      <form onSubmit={handleSubmit} style={{
        background: C.panel, border: `1px solid ${C.line}`, padding: "38px 34px", width: 368, boxShadow: "0 12px 32px rgba(15,18,34,0.08)", borderRadius: 12,
      }}>
        <div style={{ ...serif, fontSize: 20, marginBottom: 3, color: C.ink }}>Sign in</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 28 }}>Sales &amp; Commission Reporting</div>

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

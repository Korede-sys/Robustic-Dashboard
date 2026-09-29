import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "./lib/dataLayer";

const C = {
  paper: "#0C0A14", panel: "#161320", ink: "#F1EEFA", sub: "#8B84A3", line: "#292340",
  emerald: "#34D399", brick: "#F87171", navy: "#8B5CF6",
  railBg: "#0C0A14", railText: "#EDE9FE", railTextActive: "#FFFFFF", stamp: "#8B5CF6",
};
const serif = { fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", fontWeight: 700 };
const sans = { fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" };

function RobusticMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34">
      <rect x="1" y="1" width="32" height="32" rx="9" fill={C.stamp} />
      <text x="17" y="22.5" textAnchor="middle" fontFamily="'IBM Plex Sans', sans-serif" fontSize="14" fontWeight="700" fill="#0C0A14">R</text>
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
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, position: "absolute", top: 40 }}>
        <RobusticMark />
        <div style={{ ...serif, fontSize: 20, fontWeight: 600, color: C.railTextActive }}>Robustic</div>
      </div>

      <form onSubmit={handleSubmit} style={{
        background: C.panel, border: `1px solid ${C.line}`, padding: "38px 34px", width: 368, boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ ...serif, fontSize: 20, marginBottom: 3, color: C.ink }}>Sign in</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 28 }}>Sales &amp; Commission Reporting</div>

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 16, background: C.paper, color: C.ink }}
        />

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 20, background: C.paper, color: C.ink }}
        />

        {error && <div style={{ color: C.brick, fontSize: 12.5, marginBottom: 16 }}>{error}</div>}

        <button type="submit" disabled={loading} style={{
          width: "100%", background: C.navy, color: "#fff", border: "none", padding: "11px 0",
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

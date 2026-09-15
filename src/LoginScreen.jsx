import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "./lib/dataLayer";

const C = {
  paper: "#EDE7DA", panel: "#FBF9F4", ink: "#211E17", sub: "#6B6355", line: "#DCD3C0",
  emerald: "#3D6B4C", brick: "#9C3B2C", navy: "#24352A",
  railBg: "#1D2B22", railText: "#C9C0A9", railTextActive: "#F5F1E6", stamp: "#A34A28",
};
const serif = { fontFamily: "'Fraunces', Georgia, serif" };

function RobusticMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="15.5" fill="none" stroke={C.stamp} strokeWidth="1.4" strokeDasharray="1.6 2.4" />
      <circle cx="17" cy="17" r="11.5" fill="none" stroke={C.railTextActive} strokeWidth="0.75" opacity="0.45" />
      <text x="17" y="22.5" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="14" fontWeight="600" fill={C.railTextActive}>R</text>
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
      background: C.railBg, fontFamily: "'Inter', sans-serif",
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, position: "absolute", top: 40 }}>
        <RobusticMark />
        <div style={{ ...serif, fontSize: 20, fontWeight: 600, color: C.railTextActive }}>Robustic</div>
      </div>

      <form onSubmit={handleSubmit} style={{
        background: C.panel, padding: "38px 34px", width: 368, boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
      }}>
        <div style={{ ...serif, fontSize: 20, fontWeight: 600, marginBottom: 3, color: C.ink }}>Sign in</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 28 }}>Sales &amp; Commission Reporting</div>

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 16, background: "#fff" }}
        />

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 20, background: "#fff" }}
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

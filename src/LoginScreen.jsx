import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "./lib/dataLayer";

const C = {
  paper: "#F7F6F2", panel: "#FFFFFF", ink: "#14171F", sub: "#5B6472", line: "#E1DDD3",
  emerald: "#0B6E4F", brick: "#B23A2E", navy: "#1F2A3D",
};
const serif = { fontFamily: "'Fraunces', Georgia, serif" };

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
      background: C.paper, fontFamily: "'Inter', sans-serif",
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap" />
      <form onSubmit={handleSubmit} style={{
        background: C.panel, border: `1px solid ${C.line}`, padding: "36px 32px", width: 360,
      }}>
        <div style={{ ...serif, fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Robustic</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 28 }}>Sales &amp; Commission Reporting</div>

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 16 }}
        />

        <label style={{ display: "block", fontSize: 12, color: C.sub, marginBottom: 5 }}>Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ width: "100%", border: `1px solid ${C.line}`, padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", marginBottom: 20 }}
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

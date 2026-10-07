// Supabase Edge Function: the ONLY path between the dashboard and a backoffice.
//
//   Robustic Dashboard (browser) -> this function -> connector -> external backoffice
//
// The browser sends a Supabase user JWT and an action. It never sees, sends or
// stores a backoffice credential, cookie or token: those exist only as Edge
// Function secrets (set with `supabase secrets set`, never in code or in the
// database) and are read here, server-side, by the connector that owns them.
//
// Actions:  list  - which connectors exist and what is known about each (any signed-in user)
//           test  - read-only connectivity check               (admin / finance)
//           sync  - run a synchronization                      (admin / finance, or the scheduler)
//
// Deploy:   supabase functions deploy sync-source --no-verify-jwt
// (--no-verify-jwt because this function authenticates every request itself,
//  below: a user JWT checked against profiles.role, or the scheduler's secret.)

// @ts-ignore -- resolved by the Edge runtime, not by Node tooling
import { createClient } from "npm:@supabase/supabase-js@2";
import { CONNECTORS, describeConnectors } from "../_shared/registry.ts";
import { buildContext, runSync } from "../_shared/runner.ts";
import { SupabaseStore } from "../_shared/supabaseStore.ts";
import { redact } from "../_shared/sanitize.ts";
import type { SyncMode } from "../_shared/connector.ts";

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (r: Request) => Response | Promise<Response>): void;
};

const MODES: SyncMode[] = ["manual", "scheduled", "incremental", "full"];
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// Secrets are namespaced per connector (CONNECTOR_<ID>_<NAME>), so a connector
// can only ever read its own.
const secretFor = (id: string) => (name: string) =>
  Deno.env.get(`CONNECTOR_${id.toUpperCase().replace(/-/g, "_")}_${name.toUpperCase()}`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const action = String(body.action ?? "");

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return json({ error: "Server is not configured" }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ---- authenticate: scheduler secret OR a signed-in user with a profile ----
    let role: string | null = null;
    let isCron = false;
    const presented = req.headers.get("x-cron-secret");
    if (presented) {
      const expected = Deno.env.get("CRON_SECRET");
      if (!expected || !timingSafeEqual(presented, expected)) return json({ error: "Unauthorized" }, 401);
      isCron = true;
    } else {
      const auth = req.headers.get("Authorization") ?? "";
      if (!/^bearer\s+\S+/i.test(auth)) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user) return json({ error: "Unauthorized" }, 401);
      const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).single();
      if (!profile) return json({ error: "Forbidden" }, 403);
      role = profile.role as string;
    }

    // ---- list: what exists and what is known (no secrets exist on a connector) ----
    if (action === "list") return json({ connectors: describeConnectors() });

    // ---- test / sync: privileged ----
    if (action !== "test" && action !== "sync") return json({ error: "Unknown action" }, 400);
    if (!isCron && role !== "admin" && role !== "finance") return json({ error: "Forbidden" }, 403);

    const connector = CONNECTORS[String(body.source ?? "")];
    if (!connector) return json({ error: "Unknown source" }, 400);

    if (action === "test") {
      if (isCron) return json({ error: "Forbidden" }, 403);
      if (connector.status !== "implemented") {
        return json({ ok: false, state: "not_implemented", message: `${connector.displayName} has no live connector yet.` });
      }
      const { ctx, seenSecrets } = buildContext(connector, secretFor(connector.id));
      try {
        return json(await connector.testConnection(ctx));
      } catch (e) {
        return json({ ok: false, state: "error", message: redact(e, seenSecrets) });
      }
    }

    const mode = String(body.mode ?? "manual") as SyncMode;
    if (!MODES.includes(mode)) return json({ error: "Invalid mode" }, 400);
    if (isCron && mode !== "scheduled" && mode !== "incremental") return json({ error: "Forbidden" }, 403);

    const result = await runSync(
      { connector, store: new SupabaseStore(admin), getSecret: secretFor(connector.id) },
      { mode, from: body.from ? String(body.from) : undefined, to: body.to ? String(body.to) : undefined },
    );
    return json(result);
  } catch (e) {
    console.error("sync-source error:", redact(e));
    return json({ error: "Internal error" }, 500);
  }
});

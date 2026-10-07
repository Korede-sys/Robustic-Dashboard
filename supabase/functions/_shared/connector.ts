// The contract every backoffice connector implements. The dashboard, the Edge
// Function and the sync runner depend ONLY on this interface -- never on how a
// particular backoffice works -- so a backoffice can be added, replaced or
// removed without touching reporting code.
//
// Pipeline:  Backoffice -> Connector -> Raw records -> Normalization
//            -> Supabase (batches / line_items) -> existing reporting engine.
//
// A connector only FETCHES and NORMALIZES. It never calculates commission,
// never writes to the database, never touches the browser, and never logs a
// secret. Commission rules stay in the reporting engine so every formula that
// has been verified keeps working unchanged.

export type SourceId = string;
export type BatchType = "GB" | "EB" | "EB_MB" | "SP" | "SP_MB" | "XP";
export type IntegrationType =
  | "official_api" | "authorized_internal_api" | "approved_export" | "csv_upload" | "other_approved";
export type SyncMode = "manual" | "scheduled" | "incremental" | "full";
export type Capability =
  | "agents" | "sales" | "commission" | "bonuses" | "ticket_counts"
  | "tickets" | "transactions" | "wallets" | "daily";

// Exactly the line-item shape the existing reporting engine consumes
// (src/lib/engine-core.js). sourceBlock must use the engine's vocabulary
// ("EB:LUCKYBALL", "GB:FIN_OVERVIEW", "XP:OWN", ...) or the engine will ignore
// the row; the runner rejects any block it doesn't recognise.
export interface NormalizedItem {
  agentUsername: string;
  sourceBlock: string;
  tickets: number | null;
  stake: number | null;
  payout: number | null;
  profit: number | null;
  commissionAmount: number | null;
  commissionType: string | null;
  balance: number | null;
  moneyWin: number | null;
  parentUsername?: string | null;
  sourceAgentUsername?: string | null;
  isHouse: boolean;
}

// What the backoffice actually returned, untouched, plus the identity needed to
// trace every normalized row back to it.
export interface RawRecord {
  sourceRecordId?: string;          // the source's own id when it has one
  sourceTimestamp: string | null;   // when the SOURCE says the record changed
  batchType: BatchType;
  periodStart: string;              // YYYY-MM-DD
  periodEnd: string;                // YYYY-MM-DD
  payload: unknown;
}

export interface NormalizedRecord {
  sourceRecordId: string;
  sourceTimestamp: string | null;
  batchType: BatchType;
  periodStart: string;
  periodEnd: string;
  item: NormalizedItem;
}

export interface SyncWindow {
  from: string;                     // YYYY-MM-DD, inclusive
  to: string;                       // YYYY-MM-DD, inclusive
  since: string | null;             // watermark of the last successful sync (incremental)
}

export interface TestResult {
  ok: boolean;
  state: "ok" | "not_implemented" | "auth_failed" | "unreachable" | "error";
  message: string;                  // always safe to show: no secrets, no response bodies
}

// All outbound HTTP goes through this: it applies the connector's rate limit,
// timeouts and retry policy. Connectors must not call global fetch directly.
export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorContext {
  // Reads a server-side secret by NAME. Throws MissingSecretError (naming the
  // secret, never its value) if it isn't configured.
  getSecret(name: string): string;
  http: HttpClient;
  log(message: string): void;
}

export interface ConnectorAssessment {
  accessMethod: "unknown" | IntegrationType;
  known: string[];                  // facts actually observed
  unknown: string[];                // what has NOT been established
  blockers: string[];               // what must happen before this can be built
}

export interface Connector {
  readonly id: SourceId;
  readonly displayName: string;
  readonly role: "original_source" | "reporting_layer";
  // "implemented" only once the connector has been built against a PERMITTED,
  // verified access method. Until then it is "not_implemented" and the runner
  // refuses to run it -- it can never appear Connected.
  readonly status: "not_implemented" | "implemented";
  readonly integrationType: IntegrationType | null;
  readonly assessment: ConnectorAssessment;

  // null = not assessed. Never guess: a connector declares only what it has
  // actually retrieved.
  capabilities(): Partial<Record<Capability, boolean>> | null;
  rateLimit(): { minIntervalMs: number; maxRetries: number };

  testConnection(ctx: ConnectorContext): Promise<TestResult>;
  fetchWindow(ctx: ConnectorContext, window: SyncWindow): AsyncIterable<RawRecord>;
  normalize(raw: RawRecord): NormalizedRecord[];
}

export class NotImplementedError extends Error {
  constructor(public connectorId: string, detail: string) {
    super(`Connector "${connectorId}" is not implemented: ${detail}`);
    this.name = "NotImplementedError";
  }
}
export class MissingSecretError extends Error {
  constructor(public secretName: string) {
    super(`Required server-side secret "${secretName}" is not configured.`);
    this.name = "MissingSecretError";
  }
}

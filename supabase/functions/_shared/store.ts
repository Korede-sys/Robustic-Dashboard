import type { BatchType, IntegrationType, SyncMode } from "./connector.ts";

// What the runner needs from persistence. Kept as an interface so the runner is
// tested against a real Postgres (the actual migration SQL) and shipped against
// Supabase without either knowing about the other.
export interface ApplyItem {
  key: string;                       // deterministic record key
  agent_username: string;
  source_block: string;
  tickets: number | null;
  stake: number | null;
  payout: number | null;
  profit: number | null;
  commission_amount: number | null;
  commission_type: string | null;
  balance: number | null;
  is_house: boolean;
  product: string;
  parent_username: string | null;
  money_win: number | null;
  source_agent_username: string | null;
  source_record_id: string;
  source_timestamp: string | null;
}

export interface ApplyBatchParams {
  sourceId: string;
  batchType: BatchType;
  periodStart: string;
  periodEnd: string;
  integrationType: IntegrationType;
  items: ApplyItem[];
}

export interface ApplyResult {
  status: "applied" | "skipped_manual_exists" | "skipped_overlap";
  batchId: string | null;
  items: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
}

export interface RunFinish {
  status: "succeeded" | "failed" | "partial";
  recordsSeen: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  watermarkAfter: string | null;
  errorSummary: string | null;
}

export interface Store {
  hasRunningRun(sourceId: string, staleAfterMs: number): Promise<boolean>;
  lastWatermark(sourceId: string): Promise<string | null>;
  startRun(sourceId: string, mode: SyncMode, watermarkBefore: string | null): Promise<string>;
  finishRun(runId: string, result: RunFinish): Promise<void>;
  applyBatch(runId: string, params: ApplyBatchParams): Promise<ApplyResult>;
}

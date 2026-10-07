import type { SyncMode } from "./connector.ts";
import type { ApplyBatchParams, ApplyResult, RunFinish, Store } from "./store.ts";

// Minimal structural type for the parts of supabase-js used here, so this file
// type-checks without the package and the Edge Function passes in the real
// service-role client. The service-role key lives ONLY in the Edge Function
// environment and is never sent to a browser.
interface Q { select(c?: string): Q; eq(c: string, v: unknown): Q; in(c: string, v: unknown[]): Q; gt(c: string, v: unknown): Q;
  not(c: string, o: string, v: unknown): Q; order(c: string, o: { ascending: boolean }): Q; limit(n: number): Q;
  insert(v: unknown): Q; update(v: unknown): Q; single(): Promise<{ data: any; error: any }>;
  then: Promise<{ data: any; error: any }>["then"]; }
export interface SupabaseLike { from(t: string): Q; rpc(fn: string, args: unknown): Promise<{ data: any; error: any }> }

export class SupabaseStore implements Store {
  constructor(private db: SupabaseLike) {}

  async hasRunningRun(sourceId: string, staleAfterMs: number) {
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const { data, error } = await this.db.from("sync_runs").select("id").eq("source_id", sourceId)
      .eq("via", "connector").eq("status", "running").gt("started_at", cutoff).limit(1) as any;
    if (error) throw new Error(`Could not check for a running sync: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async lastWatermark(sourceId: string) {
    const { data, error } = await this.db.from("sync_runs").select("watermark_after").eq("source_id", sourceId)
      .eq("via", "connector").in("status", ["succeeded", "partial"]).not("watermark_after", "is", null)
      .order("started_at", { ascending: false }).limit(1) as any;
    if (error) throw new Error(`Could not read the last watermark: ${error.message}`);
    return data?.[0]?.watermark_after ?? null;
  }

  async startRun(sourceId: string, mode: SyncMode, watermarkBefore: string | null) {
    const { data, error } = await this.db.from("sync_runs")
      .insert({ source_id: sourceId, mode, status: "running", via: "connector", watermark_before: watermarkBefore })
      .select("id").single();
    if (error) throw new Error(`Could not start the sync run: ${error.message}`);
    return data.id as string;
  }

  async finishRun(runId: string, r: RunFinish) {
    const { error } = await this.db.from("sync_runs").update({
      status: r.status, finished_at: new Date().toISOString(), records_seen: r.recordsSeen,
      records_inserted: r.recordsInserted, records_updated: r.recordsUpdated, records_skipped: r.recordsSkipped,
      watermark_after: r.watermarkAfter, error_summary: r.errorSummary,
    }).eq("id", runId) as any;
    if (error) throw new Error(`Could not finish the sync run: ${error.message}`);
  }

  async applyBatch(runId: string, p: ApplyBatchParams): Promise<ApplyResult> {
    const { data, error } = await this.db.rpc("sync_apply_batch", {
      p_source: p.sourceId, p_type: p.batchType, p_period_start: p.periodStart, p_period_end: p.periodEnd,
      p_integration: p.integrationType, p_items: p.items, p_run: runId,
    });
    if (error) throw new Error(`Could not apply the batch: ${error.message}`);
    return {
      status: data.status, batchId: data.batch_id, items: data.items,
      inserted: data.inserted, updated: data.updated, unchanged: data.unchanged, removed: data.removed,
    };
  }
}

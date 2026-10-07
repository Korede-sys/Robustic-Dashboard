import type { Connector, ConnectorAssessment, RawRecord } from "../connector.ts";
import { NotImplementedError } from "../connector.ts";

// A connector that has been ASSESSED but not BUILT. It declares what is known
// and what blocks it, refuses to fetch, and reports itself as not implemented
// -- so the dashboard can show the true state and the runner can never mark
// the backoffice Connected. When a permitted access method is established, the
// file for that backoffice is replaced by a real implementation of Connector;
// nothing else in the system changes.
export function stubConnector(def: {
  id: string; displayName: string; role: Connector["role"]; assessment: ConnectorAssessment;
}): Connector {
  const why = def.assessment.blockers[0] ?? "no permitted access method has been established";
  return {
    ...def,
    status: "not_implemented",
    integrationType: null,
    capabilities: () => null,
    rateLimit: () => ({ minIntervalMs: 2000, maxRetries: 3 }),
    testConnection: async () => ({
      ok: false, state: "not_implemented",
      message: `${def.displayName} has no live connector yet: ${why}`,
    }),
    // deno-lint-ignore require-yield
    async *fetchWindow(): AsyncIterable<RawRecord> { throw new NotImplementedError(def.id, why); },
    normalize() { throw new NotImplementedError(def.id, why); },
  };
}

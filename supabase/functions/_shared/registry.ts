import type { Connector } from "./connector.ts";
import { globalbet } from "./connectors/globalbet.ts";
import { elbet } from "./connectors/elbet.ts";
import { xpool } from "./connectors/xpool.ts";
import { walify } from "./connectors/walify.ts";

// The one place a connector is registered. Adding a backoffice means adding a
// file under connectors/ and one line here.
export const CONNECTORS: Record<string, Connector> = { globalbet, elbet, xpool, walify };

// Safe-to-expose description (no secrets exist on a connector, but nothing
// beyond this is ever sent to the browser).
export function describeConnectors() {
  return Object.values(CONNECTORS).map((c) => ({
    id: c.id, displayName: c.displayName, role: c.role, status: c.status,
    integrationType: c.integrationType, capabilities: c.capabilities(), assessment: c.assessment,
  }));
}

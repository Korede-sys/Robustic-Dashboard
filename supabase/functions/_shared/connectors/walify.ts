import { stubConnector } from "./_stub.ts";

export const walify = stubConnector({
  id: "walify",
  displayName: "Walify",
  role: "reporting_layer",
  assessment: {
    accessMethod: "unknown",
    known: [
      "Platform at shop.accessbet.com; it gets its reports from Elbet and Globalbet and is the original source of no product.",
    ],
    unknown: [
      "Whether Walify offers an API, a scheduled export, or a read-only account.",
      "Whether automated access is permitted.",
    ],
    blockers: [
      "No connector is needed to receive data: Elbet and Globalbet are the originals. One would only be useful to cross-check Walify's copies against them, and its rows must never be added on top of the originals.",
    ],
  },
});

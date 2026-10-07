import { stubConnector } from "./_stub.ts";

export const xpool = stubConnector({
  id: "xpool",
  displayName: "Xpool",
  role: "original_source",
  assessment: {
    accessMethod: "unknown",
    known: [
      "Backoffice at xpool.accessbet.com; Reports -> Agent Breakdown has an Export button.",
      "The export has a verified parser (XP) that reproduces Xpool's own on-screen totals exactly.",
      "Xpool calculates and pays commission itself, so its commission is reported, not payable by us.",
    ],
    unknown: [
      "Whether Xpool offers an API, a scheduled export, or a read-only account.",
      "Whether automated access to the owner's data is permitted.",
      "The authentication method.",
    ],
    blockers: ["The provider has not confirmed a permitted programmatic access method (API, scheduled export, or read-only account)."],
  },
});

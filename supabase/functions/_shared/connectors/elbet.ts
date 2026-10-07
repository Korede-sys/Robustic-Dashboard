import { stubConnector } from "./_stub.ts";

export const elbet = stubConnector({
  id: "elbet",
  displayName: "Elbet",
  role: "original_source",
  assessment: {
    accessMethod: "unknown",
    known: [
      "Backoffice at backoffice.accessbet.elbet.com (login page only; nothing further has been inspected).",
      "Its reports (Luckyball, Luckygreek, Rocket Man) export as PDF and Excel; the owner downloads them directly.",
      "The uploaded sheet layouts have verified parsers (EB, EB_MB).",
    ],
    unknown: [
      "Whether Elbet offers an API, a scheduled export, or a read-only account.",
      "Whether automated access to the owner's data is permitted.",
      "The authentication method.",
      "Whether the uploaded Elbet sheet is a raw export or hand-assembled from three downloads (a raw sample is needed).",
    ],
    blockers: ["The provider has not confirmed a permitted programmatic access method (API, scheduled export, or read-only account)."],
  },
});

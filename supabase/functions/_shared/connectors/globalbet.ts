import { stubConnector } from "./_stub.ts";

export const globalbet = stubConnector({
  id: "globalbet",
  displayName: "Globalbet",
  role: "original_source",
  assessment: {
    accessMethod: "unknown",
    known: [
      "Backoffice at walify.virtual-horizon.com/engine/backoffice has a date-range report with 'Export to PDF | CSV' buttons (observed in a screenshot).",
      "The owner has direct access and downloads these reports today.",
      "Both report layouts (Financial Overview tree and the flat legacy file) already have verified parsers for uploaded CSVs.",
      "Globalbet is the source of truth for Globalbet commission and bonus.",
    ],
    unknown: [
      "Whether Globalbet offers an API, a scheduled export, or a read-only account.",
      "Whether automated access to the owner's data is permitted.",
      "The authentication method.",
      "Whether a live feed would supply the per-agent inputs that bonus, palliative and gift are calculated from (today those come from a manually enriched sheet).",
    ],
    blockers: ["The provider has not confirmed a permitted programmatic access method (API, scheduled export, or read-only account)."],
  },
});

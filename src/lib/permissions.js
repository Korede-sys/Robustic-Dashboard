// Mirrors the Row Level Security policies in schema.sql exactly, so the UI can
// hide buttons/tabs a role can't use. This is a convenience, not the security
// boundary -- the database enforces the real rule via RLS regardless of what
// the UI shows, so a mismatch here is a UX bug, not a security hole.
const PERMISSIONS = {
  admin:   ["view_reports", "upload", "delete_upload", "export", "manage_followups", "manage_users"],
  finance: ["view_reports", "upload", "delete_upload", "export", "manage_followups"],
  manager: ["view_reports", "manage_followups"],
  viewer:  ["view_reports"],
};

export function can(role, action) {
  return (PERMISSIONS[role] || []).includes(action);
}

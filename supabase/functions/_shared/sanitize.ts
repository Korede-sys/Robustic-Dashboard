// Nothing that leaves the server -- run history, API responses, logs -- may
// contain a credential. Errors from a backoffice are the usual leak (a URL with
// a token, an echoed header, a response body), so every message is passed
// through here before it is stored or returned. Known secret VALUES are removed
// literally; common credential shapes are removed by pattern as a second net.
const SENSITIVE_KEYS =
  "authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|secret|session(?:[_-]?id)?|csrf|xsrf|bearer";

export function redact(input: unknown, knownSecrets: string[] = []): string {
  let s = input instanceof Error ? input.message : String(input ?? "");
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) s = s.split(secret).join("[REDACTED]");
  }
  s = s
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+\/=]{8,}/gi, "Basic [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[REDACTED-JWT]")
    .replace(new RegExp(`(\\b(?:${SENSITIVE_KEYS})\\b)(["']?\\s*[:=]\\s*["']?)[^\\s,;&"'}]+`, "gi"), "$1$2[REDACTED]")
    .replace(/(\/\/)[^\/\s:@]+:[^\/\s@]+@/g, "$1[REDACTED]@")
    .replace(/[A-Za-z0-9_\-]{40,}/g, "[REDACTED-LONG-TOKEN]");
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

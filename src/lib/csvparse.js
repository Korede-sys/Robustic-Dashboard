// Minimal RFC4180 CSV parser (handles quoted fields, embedded commas, escaped quotes, CRLF/LF).
// Delimiter is auto-detected from the first line (counting only unquoted occurrences) so
// files exported with ";" (common in European/backoffice exports) work the same as plain
// comma files, without needing the caller to know which one a given file uses.
function detectDelimiter(text) {
  // Scan the first several lines rather than just the first -- some exports
  // (like this one) lead with a free-text title/date-range line that has no
  // delimiters in it at all, so checking only line 1 would find nothing.
  const lines = text.split(/\r?\n/).slice(0, 5);
  let commas = 0, semicolons = 0;
  for (const line of lines) {
    let inQuotes = false;
    for (const c of line) {
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && c === ",") commas++;
      else if (!inQuotes && c === ";") semicolons++;
    }
  }
  return semicolons > commas ? ";" : ",";
}

function parseCSV(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export { parseCSV, detectDelimiter };

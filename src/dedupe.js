// Real backend data (confirmed against the live campaign-manager module) contains
// keys that are byte-for-byte duplicates of each other except for incidental
// leading/trailing whitespace, e.g. "CAMPAIGN_ADD_PRODUCT_MANDATORY_ERROR" vs
// " CAMPAIGN_ADD_PRODUCT_MANDATORY_ERROR ". Exact-string comparisons elsewhere
// in this tool (missing-key detection, dead-key detection) must not treat these
// as different keys, or they produce false positives against real data.
export function normalizeKey(key) {
  return key.trim();
}

// Given a flat array of { code, ... } entries, groups any whose normalized code
// collides with another entry's. Does NOT merge or drop anything — every raw
// backend record is real and stays as-is; this only reports the collision so a
// human can decide whether to clean it up.
export function findWhitespaceDuplicates(entries) {
  const byNormalized = new Map();
  for (const entry of entries) {
    const norm = normalizeKey(entry.code);
    if (!byNormalized.has(norm)) byNormalized.set(norm, []);
    byNormalized.get(norm).push(entry);
  }
  return [...byNormalized.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalized, group]) => ({ normalized, group }));
}

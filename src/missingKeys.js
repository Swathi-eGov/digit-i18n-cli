import { findSourceFiles, scanFilesForKeys } from "./scanner.js";
import { loadAllMessages } from "./registry.js";
import { normalizeKey } from "./dedupe.js";

// Shared by `scan` (reports the gap) and `suggest` (drafts payloads to close it).
// A key counts as "known" if it's in the synced registry OR already staged as
// a pending entry (via `add`) — either way, someone already gave it a message.
//
// Comparison is whitespace-normalized on both sides: real synced data has been
// confirmed to contain keys with incidental leading/trailing whitespace (e.g.
// " CAMPAIGN_ADD_PRODUCT_MANDATORY_ERROR"). Without normalizing, a clean key
// referenced in code would be wrongly reported as missing just because the
// backend's copy of the same key has stray whitespace.
export async function computeMissingKeys({ pattern, locale }) {
  const files = await findSourceFiles(pattern);
  const { entries, dynamic, errors } = await scanFilesForKeys(files);

  const known = new Set(loadAllMessages(locale).map((e) => normalizeKey(e.code)));

  const byKey = new Map();
  for (const { key, file, line } of entries) {
    if (known.has(normalizeKey(key))) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ file, line });
  }

  return {
    files,
    missing: [...byKey.entries()].map(([key, locations]) => ({ key, locations })),
    dynamic,
    errors,
    totalUniqueKeysInCode: new Set(entries.map((e) => e.key)).size,
  };
}

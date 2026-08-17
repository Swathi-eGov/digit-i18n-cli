import Fuse from "fuse.js";
import { loadAllMessages } from "../registry.js";
import { findWhitespaceDuplicates, normalizeKey } from "../dedupe.js";
import { ensureFreshData } from "../freshness.js";

export async function searchCommand(query, { module: moduleFilter, locale, limit, maxAge, tenantId }) {
  await ensureFreshData({ locale, maxAgeMinutes: maxAge, tenantId });

  let entries = loadAllMessages(locale);

  if (moduleFilter) {
    entries = entries.filter((e) => e.module === moduleFilter);
  }

  if (!entries.length) {
    console.log(
      `No local data found for locale "${locale}"${moduleFilter ? ` in module "${moduleFilter}"` : ""}.\n` +
        `Run "digit-i18n sync --modules <module1,module2> --locale ${locale}" first.`
    );
    return;
  }

  const fuse = new Fuse(entries, {
    keys: ["code", "message"],
    threshold: 0.4,
    includeScore: true,
  });

  const results = fuse.search(query).slice(0, limit);

  if (!results.length) {
    console.log(`No matches for "${query}". This looks like it may genuinely be a new key.`);
    return;
  }

  // Real synced data has been confirmed to contain keys that are duplicates of
  // each other except for incidental whitespace — surface that here so a
  // developer doesn't unknowingly pick the "wrong" one of several variants.
  const dupSiblingCounts = new Map();
  findWhitespaceDuplicates(entries).forEach(({ group }) => {
    group.forEach((e) => dupSiblingCounts.set(e.code, group.length - 1));
  });

  console.log(`Top matches for "${query}":\n`);
  results.forEach(({ item, score }) => {
    const confidence = (1 - score).toFixed(2);
    const pendingTag = item.pending ? " [pending, not yet uploaded]" : "";
    const siblingCount = dupSiblingCounts.get(item.code);
    const dupTag = siblingCount
      ? ` [${siblingCount} whitespace-variant duplicate(s) also exist for "${normalizeKey(item.code)}" — check before reusing]`
      : "";
    console.log(
      `  [${item.module}] ${item.code}  ->  "${item.message}"   (match: ${confidence})${pendingTag}${dupTag}`
    );
  });
}

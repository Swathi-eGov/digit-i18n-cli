import Fuse from "fuse.js";
import { addPendingEntry, loadAllMessages } from "../registry.js";
import { resolvePrefix, getCommonPrefix, listPrefixes } from "../moduleRegistry.js";
import { buildKey, looksGeneric } from "../naming.js";

// Named "stage" (not "add") deliberately — mirrors git's staging metaphor:
// this only ever writes a local pending file, never the backend. An earlier
// name, "add", was flagged by the user's peers as misleading (reads as "adds
// to the system", which most people take to mean the live backend).
export function stageCommand(rawKey, { module: modulePrefix, message, locale }) {
  if (!modulePrefix) {
    console.error("Missing required option: --module <PREFIX>");
    process.exitCode = 1;
    return;
  }
  if (!message) {
    console.error("Missing required option: --message <text>");
    process.exitCode = 1;
    return;
  }

  const entry = resolvePrefix(modulePrefix);
  if (!entry) {
    console.error(
      `Unknown module prefix "${modulePrefix}". Registered prefixes: ${listPrefixes().join(", ") || "(none — check digit-i18n.config.json)"}`
    );
    process.exitCode = 1;
    return;
  }

  const commonPrefix = getCommonPrefix();
  if (!entry.isCommon && looksGeneric(rawKey)) {
    console.log(
      `Note: "${rawKey}" looks like a generic/common concept. Consider using ` +
        `--module ${commonPrefix} instead so other modules can reuse it, e.g.:\n` +
        `  digit-i18n stage ${rawKey} --module ${commonPrefix} --message "${message}"\n`
    );
  }

  const key = buildKey(entry.prefix, rawKey);

  // Warn on likely duplicates (fuzzy match against everything already known
  // locally, synced or pending) before staging — doesn't block, just informs.
  const existing = loadAllMessages(locale);
  if (existing.length) {
    const fuse = new Fuse(existing, { keys: ["code", "message"], threshold: 0.35, includeScore: true });
    const matches = fuse.search(message).filter((r) => r.item.code !== key);
    if (matches.length) {
      console.log(`Possible existing match(es) for "${message}" — consider reusing instead of creating a new key:`);
      matches.slice(0, 3).forEach(({ item }) => {
        console.log(`  [${item.module}] ${item.code}  ->  "${item.message}"`);
      });
      console.log("");
    }
  }

  const { file, isNew, previousMessage } = addPendingEntry(entry.backendModule, locale, key, message);

  if (isNew) {
    console.log(`Staged new key: ${key}`);
  } else {
    console.log(`Updated pending key: ${key} (was: "${previousMessage}")`);
  }
  console.log(`  -> ${file}`);
  console.log(
    `\nThis is staged locally only — it has not been uploaded to the backend. ` +
      `A future "export" step will produce a review-ready upload payload for this and any other pending keys.`
  );
}

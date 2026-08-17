import fs from "fs";
import path from "path";
import config from "./config.js";

// Tracks when each module/locale was last pulled from the backend, so other
// commands can warn (or, opt-in, auto-refresh) when working off stale data.
// Separate from the message files themselves — this is bookkeeping, not
// translation content.
function metaFilePath() {
  return path.join(config.localizationsDir, ".sync-meta.json");
}

function readMeta() {
  const file = metaFilePath();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeMeta(meta) {
  const file = metaFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
}

export function stampSync(moduleName, locale, timestamp) {
  const meta = readMeta();
  if (!meta[moduleName]) meta[moduleName] = {};
  meta[moduleName][locale] = { lastSyncedAt: timestamp };
  writeMeta(meta);
}

export function getLastSyncedAt(moduleName, locale) {
  return readMeta()[moduleName]?.[locale]?.lastSyncedAt ?? null;
}

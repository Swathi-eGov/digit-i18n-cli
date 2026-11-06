import fs from "fs";
import path from "path";
import config from "./config.js";

// Two files per module/locale:
//   <locale>.json          — pure mirror of the backend, only ever touched by `sync`
//   <locale>.pending.json   — new keys staged locally by `stage`, not yet uploaded anywhere.
// Kept separate deliberately so "<locale>.json" always reflects "what's actually
// live" and never gets silently mixed with not-yet-real local additions.

export function moduleFilePath(moduleName, locale) {
  return path.join(config.localizationsDir, moduleName, `${locale}.json`);
}

export function modulePendingFilePath(moduleName, locale) {
  return path.join(config.localizationsDir, moduleName, `${locale}.pending.json`);
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonSorted(file, messagesObj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.keys(messagesObj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = messagesObj[key];
      return acc;
    }, {});
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
  return file;
}

export function readModuleMessages(moduleName, locale) {
  return readJsonIfExists(moduleFilePath(moduleName, locale));
}

export function writeModuleMessages(moduleName, locale, messagesObj) {
  return writeJsonSorted(moduleFilePath(moduleName, locale), messagesObj);
}

export function readModulePending(moduleName, locale) {
  return readJsonIfExists(modulePendingFilePath(moduleName, locale));
}

export function writeModulePending(moduleName, locale, messagesObj) {
  return writeJsonSorted(modulePendingFilePath(moduleName, locale), messagesObj);
}

// Adds (or updates) a single pending entry for a module/locale. Returns
// { file, isNew, previousMessage } so callers can warn on overwrite.
export function addPendingEntry(moduleName, locale, code, message) {
  const pending = readModulePending(moduleName, locale);
  const synced = readModuleMessages(moduleName, locale);
  const isNew = !(code in pending) && !(code in synced);
  const previousMessage = pending[code] ?? synced[code] ?? null;
  pending[code] = message;
  const file = writeModulePending(moduleName, locale, pending);
  return { file, isNew, previousMessage };
}

export function listModules() {
  if (!fs.existsSync(config.localizationsDir)) return [];
  return fs
    .readdirSync(config.localizationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// Flattens every module's messages (synced + pending) for a given locale into
// one array, e.g. [{ module, code, message, pending }, ...] — used by `search`
// and `lint`'s duplicate check. Pending entries are tagged so callers can
// distinguish "already live" from "staged, not uploaded yet".
export function loadAllMessages(locale, { includePending = true } = {}) {
  const modules = listModules();
  const all = [];
  for (const moduleName of modules) {
    const synced = readModuleMessages(moduleName, locale);
    for (const [code, message] of Object.entries(synced)) {
      all.push({ module: moduleName, code, message, pending: false });
    }
    if (includePending) {
      const pending = readModulePending(moduleName, locale);
      for (const [code, message] of Object.entries(pending)) {
        if (code in synced) continue; // synced wins if a key exists in both
        all.push({ module: moduleName, code, message, pending: true });
      }
    }
  }
  return all;
}

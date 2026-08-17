import config from "./config.js";
import { computeMissingKeys } from "./missingKeys.js";
import { listModules, readModulePending } from "./registry.js";
import { keySuffixTokens } from "./naming.js";

// Shared by `export` and `apply` — both need the same "everything that has
// (or needs) a message in the source locale" collection, just do different
// things with the result afterward (write a file vs. build a real payload).

// Deliberately dumb/deterministic: title-cases the key's suffix tokens.
// This is an MVP heuristic, not context-aware drafting — every drafted
// message is marked `_needsReview: true` and must be checked by a human
// before it's used for anything.
export function draftMessage(key) {
  const tokens = keySuffixTokens(key);
  if (!tokens.length) return key;
  return tokens.map((t) => t.charAt(0) + t.slice(1).toLowerCase()).join(" ");
}

// Reverses DIGIT_{PREFIX}_... back to a real backend module tag via the
// same config `stage` uses to go the other direction.
export function resolveBackendModule(key) {
  const parts = key.split("_");
  if (parts.length < 3 || parts[0] !== "DIGIT") return null;
  const entry = config.moduleRegistry.modules?.[parts[1]];
  return entry ? entry.backendModule : null;
}

export async function collectPendingAndDrafted({ pattern, locale }) {
  const pendingPayload = [];
  for (const moduleName of listModules()) {
    const pending = readModulePending(moduleName, locale);
    for (const [code, message] of Object.entries(pending)) {
      pendingPayload.push({ module: moduleName, locale, code, message, source: "pending" });
    }
  }

  const { missing, dynamic } = await computeMissingKeys({ pattern, locale });

  const draftedPayload = [];
  const unresolvedModule = [];
  for (const { key, locations } of missing) {
    const backendModule = resolveBackendModule(key);
    if (!backendModule) {
      unresolvedModule.push({ key, locations });
      continue;
    }
    draftedPayload.push({
      module: backendModule,
      locale,
      code: key,
      message: draftMessage(key),
      source: "drafted",
      _needsReview: true,
      _foundAt: locations.map((l) => `${l.file}:${l.line ?? "?"}`),
    });
  }

  return { pendingPayload, draftedPayload, unresolvedModule, dynamic };
}

import config from "./config.js";

export function listPrefixes() {
  return Object.keys(config.moduleRegistry.modules || {});
}

export function resolvePrefix(prefix) {
  const entry = config.moduleRegistry.modules?.[prefix?.toUpperCase()];
  if (!entry) return null;
  return { prefix: prefix.toUpperCase(), ...entry };
}

export function getCommonPrefix() {
  return config.moduleRegistry.commonModule || "COMMON";
}

export function getCommonEntry() {
  return resolvePrefix(getCommonPrefix());
}

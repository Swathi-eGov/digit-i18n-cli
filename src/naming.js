// Naming convention: DIGIT_{MODULE}_{KEY}
// Shared by `add` (enforces on creation) and `lint` (validates existing usage).

const KEY_FORMAT = /^DIGIT_[A-Z0-9]+(?:_[A-Z0-9]+)+$/;

export function slugify(raw) {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildKey(prefix, rawKey) {
  return `DIGIT_${slugify(prefix)}_${slugify(rawKey)}`;
}

export function isValidKeyFormat(key) {
  return KEY_FORMAT.test(key);
}

// Strips "DIGIT" and the module segment, leaving the meaningful suffix tokens,
// e.g. "DIGIT_CAMPAIGN_SAVE_BUTTON" -> ["SAVE", "BUTTON"]. Used to compare a
// key against the common module's keys regardless of which module declared it.
export function keySuffixTokens(key) {
  const parts = key.split("_");
  return parts.slice(2);
}

// A short, deliberately generic list of concepts that almost always belong in
// the common module rather than being redeclared per module. Not exhaustive —
// this is a heuristic nudge for `add`, not an enforced rule.
export const GENERIC_WORDS = [
  "SAVE",
  "CANCEL",
  "SEARCH",
  "EDIT",
  "DELETE",
  "SUBMIT",
  "CONFIRM",
  "CLOSE",
  "BACK",
  "NEXT",
  "PREVIOUS",
  "YES",
  "NO",
  "OK",
  "NA",
  "ADD",
  "REMOVE",
  "UPLOAD",
  "DOWNLOAD",
  "VIEW",
  "PRINT",
  "EXPORT",
  "IMPORT",
  "CLEAR",
  "RESET",
  "CONTINUE",
  "FINISH",
  "DONE",
  "LOADING",
  "ERROR",
  "SUCCESS",
  "WARNING",
  "REQUIRED",
  "OPTIONAL",
  "ACTIVE",
  "INACTIVE",
  "ENABLE",
  "DISABLE",
  "NAME",
  "DESCRIPTION",
  "DATE",
  "STATUS",
  "ACTIONS",
  "SELECT",
  "ALL",
  "NONE",
];

// True if every token of the raw key (before prefixing) is a generic word,
// e.g. "SAVE" -> true, "SAVE_BUTTON" -> false (BUTTON isn't generic on its own,
// so this stays a suggestion rather than a hard rule).
export function looksGeneric(rawKey) {
  const tokens = slugify(rawKey).split("_").filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => GENERIC_WORDS.includes(t));
}

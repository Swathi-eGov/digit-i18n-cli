import { findSourceFiles, scanFilesForKeys } from "../scanner.js";
import { readModuleMessages, readModulePending } from "../registry.js";
import { getCommonEntry } from "../moduleRegistry.js";
import { isValidKeyFormat, keySuffixTokens } from "../naming.js";

function getCommonKeys(locale) {
  const commonEntry = getCommonEntry();
  if (!commonEntry) return [];
  const synced = readModuleMessages(commonEntry.backendModule, locale);
  const pending = readModulePending(commonEntry.backendModule, locale);
  return [...new Set([...Object.keys(synced), ...Object.keys(pending)])];
}

export async function lintCommand({ path: pattern, locale, strict }) {
  const files = await findSourceFiles(pattern);
  console.log(`Scanning ${files.length} file(s) matching "${pattern}"...\n`);

  const { entries, dynamic, errors } = await scanFilesForKeys(files);

  errors.forEach(({ file, error }) => {
    console.log(`  [skip] ${file} — could not parse (${error})`);
  });

  const commonEntry = getCommonEntry();
  const commonKeys = getCommonKeys(locale);
  const commonKeySuffixes = new Map(commonKeys.map((k) => [keySuffixTokens(k).join("_"), k]));

  const namingViolations = [];
  const duplicateCandidates = [];
  const seen = new Set();

  for (const { key, file, line } of entries) {
    if (seen.has(key)) continue;
    seen.add(key);

    if (!isValidKeyFormat(key)) {
      namingViolations.push({ key, file, line });
      continue; // don't also run the duplicate check on a malformed key
    }

    const isCommonKey = commonEntry && key.startsWith(`DIGIT_${commonEntry.prefix}_`);
    if (isCommonKey) continue;

    const suffix = keySuffixTokens(key).join("_");
    if (commonKeySuffixes.has(suffix)) {
      duplicateCandidates.push({ key, file, line, existing: commonKeySuffixes.get(suffix) });
    }
  }

  console.log(`Unique keys found in code: ${seen.size}\n`);

  if (namingViolations.length) {
    console.log(`Naming convention violations (expected DIGIT_{MODULE}_{KEY}): ${namingViolations.length}`);
    namingViolations.forEach(({ key, file, line }) => {
      console.log(`  ${key}  (${file}:${line ?? "?"})`);
    });
    console.log("");
  } else {
    console.log("No naming convention violations found.\n");
  }

  if (duplicateCandidates.length) {
    console.log(`Possible duplicates of an existing common-module key: ${duplicateCandidates.length}`);
    duplicateCandidates.forEach(({ key, file, line, existing }) => {
      console.log(`  ${key}  (${file}:${line ?? "?"})  — consider reusing ${existing} instead`);
    });
    console.log("");
  } else {
    console.log("No likely duplicates of common-module keys found.\n");
  }

  if (dynamic.length) {
    console.log(
      `Dynamically-built t(...) calls skipped (key isn't a plain string literal): ${dynamic.length} — needs manual review, not covered by this check:`
    );
    dynamic.forEach(({ file, line }) => {
      console.log(`  ${file}:${line ?? "?"}`);
    });
    console.log("");
  }

  const totalIssues = namingViolations.length + duplicateCandidates.length;
  console.log(
    totalIssues
      ? `${totalIssues} issue(s) found. This is a warn-only check for now — it does not fail the build.`
      : "No issues found."
  );
  if (dynamic.length) {
    console.log(
      `Note: ${dynamic.length} dynamic call site(s) could not be checked at all — see above. Coverage is not 100%.`
    );
  }

  if (strict && totalIssues > 0) {
    process.exitCode = 1;
  }
}

import { findSourceFiles, scanFilesForKeys } from "../scanner.js";
import { loadAllMessages } from "../registry.js";
import { normalizeKey } from "../dedupe.js";
import { ensureFreshData } from "../freshness.js";

// Inverse of `scan`: instead of "code references a key with no message",
// this asks "does a known key still get referenced anywhere in code?"
//
// Comparison is whitespace-normalized (see src/dedupe.js) so a registry key
// with incidental leading/trailing whitespace isn't wrongly reported as dead
// just because its raw string doesn't byte-match the clean key used in code.
export async function deadcheckCommand({ path: pattern, locale, maxAge, tenantId }) {
  await ensureFreshData({ locale, maxAgeMinutes: maxAge, tenantId });

  console.log(`Checking for dead keys (locale: ${locale})...\n`);

  const files = await findSourceFiles(pattern);
  const { entries, dynamic, errors } = await scanFilesForKeys(files);

  errors.forEach(({ file, error }) => {
    console.log(`  [skip] ${file} — could not parse (${error})`);
  });

  const usedKeys = new Set(entries.map((e) => normalizeKey(e.key)));
  const known = loadAllMessages(locale);
  const dead = known.filter((k) => !usedKeys.has(normalizeKey(k.code)));

  console.log(`Files scanned: ${files.length}`);
  console.log(`Known keys (synced + pending): ${known.length}`);
  console.log(`Referenced somewhere in code: ${known.length - dead.length}`);
  console.log(`Dead-key candidates (no reference found): ${dead.length}\n`);

  if (dead.length) {
    const byModule = new Map();
    dead.forEach((k) => {
      if (!byModule.has(k.module)) byModule.set(k.module, []);
      byModule.get(k.module).push(k);
    });
    for (const [moduleName, keys] of byModule) {
      console.log(`  [${moduleName}]`);
      keys.forEach((k) => {
        const pendingTag = k.pending ? "  [pending, never even uploaded]" : "";
        console.log(`    ${k.code}  ->  "${k.message}"${pendingTag}`);
      });
    }
    console.log(
      "\nThese are candidates only — nothing is deleted automatically. Confirm before removing (see caveat below if any dynamic call sites were found)."
    );
  } else {
    console.log("No dead-key candidates found.");
  }

  if (dynamic.length) {
    console.log(
      `\nCaveat: ${dynamic.length} dynamically-built t(...) call site(s) found (key assembled from a variable/template, ` +
        `not a fixed string). Their exact key can't be resolved statically, so a key that is ONLY ever referenced this ` +
        `way may be wrongly listed above as dead. Cross-check against these locations before removing anything:`
    );
    dynamic.forEach(({ file, line }) => {
      console.log(`  ${file}:${line ?? "?"}`);
    });
  }
}

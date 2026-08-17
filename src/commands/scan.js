import { computeMissingKeys } from "../missingKeys.js";
import { ensureFreshData } from "../freshness.js";

export async function scanCommand({ path: pattern, locale, maxAge, tenantId }) {
  await ensureFreshData({ locale, maxAgeMinutes: maxAge, tenantId });

  console.log(`Scanning for t(...) calls matching "${pattern}" (locale: ${locale})...\n`);

  const { files, missing, dynamic, errors, totalUniqueKeysInCode } = await computeMissingKeys({
    pattern,
    locale,
  });

  errors.forEach(({ file, error }) => {
    console.log(`  [skip] ${file} — could not parse (${error})`);
  });

  console.log(`Files scanned: ${files.length}`);
  console.log(`Unique keys referenced in code: ${totalUniqueKeysInCode}`);
  console.log(`Keys with no translation anywhere (synced or pending): ${missing.length}\n`);

  if (missing.length) {
    missing.forEach(({ key, locations }) => {
      const where = locations.map((l) => `${l.file}:${l.line ?? "?"}`).join(", ");
      console.log(`  ${key}\n    ${where}`);
    });
    console.log(`\nRun "digit-i18n export" to draft messages and generate a review-ready upload payload for these.`);
  } else {
    console.log("Nothing missing — every key referenced in code already has a translation (synced or pending).");
  }

  if (dynamic.length) {
    console.log(
      `\nNote: ${dynamic.length} dynamically-built t(...) call site(s) could not be checked — not counted above, needs manual review:`
    );
    dynamic.forEach(({ file, line }) => {
      console.log(`  ${file}:${line ?? "?"}`);
    });
  }
}

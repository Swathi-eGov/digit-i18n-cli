import fs from "fs";
import path from "path";
import config from "../config.js";
import { collectPendingAndDrafted } from "../collectEntries.js";
import { ensureFreshData } from "../freshness.js";
import { translateEntries } from "../translate.js";

// Named "export" (not "suggest") deliberately — the command's job is to
// produce an exportable file, nothing more; the old name didn't make that
// clear enough (ambiguous about *what* was being suggested, and didn't
// signal "this only ever writes a local file"). Flagged by the user's
// peers as misleading, alongside "add" -> "stage" (see stage.js).
//
// `export` never calls the backend, even to upload — for that, see `apply`,
// which is the ONLY command in this tool that ever writes to the backend,
// and only when a human explicitly runs it and confirms.

// Grouped per module, matching the real _upsert request-body shape:
// { tenantId, module, locale, messages: [{ code, message, module, locale }, ...] }
// — one batch per module, each directly usable as one real upsert call
// (aside from the review-only extra fields, which aren't part of the real
// schema — strip those before actually sending anything).
function writeBatchFile({ entries, locale, tenantId, outFile }) {
  const byModule = new Map();
  for (const entry of entries) {
    if (!byModule.has(entry.module)) byModule.set(entry.module, []);
    byModule.get(entry.module).push(entry);
  }
  const batches = [...byModule.entries()].map(([moduleName, messages]) => ({
    tenantId,
    module: moduleName,
    locale,
    messages,
  }));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(batches, null, 2) + "\n");
  return batches.length;
}

export async function exportCommand({ path: pattern, locale, tenantId, out, maxAge, translateTo }) {
  const resolvedTenantId = tenantId || config.tenantId || null;

  await ensureFreshData({ locale, maxAgeMinutes: maxAge, tenantId });

  console.log("Collecting pending entries staged by `stage` (already have a human-authored message)...");
  console.log("Scanning code for keys with no translation anywhere...");
  const { pendingPayload, draftedPayload, unresolvedModule, dynamic } = await collectPendingAndDrafted({
    pattern,
    locale,
  });

  const fullPayload = [...pendingPayload, ...draftedPayload];
  let wroteFile = false;

  if (!fullPayload.length) {
    console.log("\nNothing to export — no pending entries and no missing keys with a resolvable module.");
  } else {
    const outFile = out
      ? path.resolve(process.cwd(), out)
      : path.join(config.localizationsDir, `export.${locale}.json`);
    const batchCount = writeBatchFile({ entries: fullPayload, locale, tenantId: resolvedTenantId, outFile });
    wroteFile = true;
    console.log(`\nWrote ${fullPayload.length} entrie(s) across ${batchCount} module batch(es) to ${outFile}`);
    console.log(`  - ${pendingPayload.length} developer-authored (via "stage"), ready to review`);
    console.log(`  - ${draftedPayload.length} auto-drafted from the key name — needs human review before use`);
  }

  if (unresolvedModule.length) {
    console.log(
      `\n${unresolvedModule.length} key(s) found in code with an unrecognized module prefix — could not determine a backend module, so nothing was drafted for these:`
    );
    unresolvedModule.forEach(({ key, locations }) => {
      console.log(`  ${key}  (${locations.map((l) => `${l.file}:${l.line ?? "?"}`).join(", ")})`);
    });
  }

  if (dynamic.length) {
    console.log(
      `\nNote: ${dynamic.length} dynamically-built t(...) call site(s) could not be checked or drafted at all — review manually.`
    );
  }

  // Machine translation, one target locale at a time, each written to its own
  // file — uses a free/unofficial translation endpoint (no API key), which
  // is explicitly NOT an officially supported service: no SLA, can be
  // rate-limited or blocked without notice. Every translated entry is marked
  // both `_needsReview` and `_machineTranslated` — this needs a human check
  // more than the English draft does, not less.
  if (translateTo?.length && fullPayload.length) {
    console.log(`\nTranslating ${fullPayload.length} entrie(s) into ${translateTo.length} target locale(s)...`);
    console.log("(Uses a free, unofficial translation endpoint — no SLA, treat failures as expected, not a bug.)");

    for (const targetLocale of translateTo) {
      if (targetLocale === locale) {
        console.log(`  [${targetLocale}] skipped — same as the source locale.`);
        continue;
      }

      const { translated, failed } = await translateEntries(fullPayload, targetLocale, locale);
      const translatedEntries = translated.map((entry) => ({
        ...entry,
        locale: targetLocale,
        _needsReview: true,
        _machineTranslated: true,
        _translatedFrom: locale,
      }));

      if (translatedEntries.length) {
        const targetOutFile = path.join(config.localizationsDir, `export.${targetLocale}.json`);
        const batchCount = writeBatchFile({
          entries: translatedEntries,
          locale: targetLocale,
          tenantId: resolvedTenantId,
          outFile: targetOutFile,
        });
        console.log(`  [${targetLocale}] wrote ${translatedEntries.length} entrie(s) across ${batchCount} module batch(es) to ${targetOutFile}`);
      }

      if (failed.length) {
        console.log(`  [${targetLocale}] ${failed.length} entrie(s) failed to translate (skipped, not written):`);
        failed.forEach((f) => console.log(`      ${f.code}: ${f.error}`));
      }
    }
  }

  if (wroteFile) {
    console.log(
      "\nThese files are EXPORTS only — suggestions for a human to review. Nothing has been uploaded to the " +
        'backend. Review them — especially entries marked "drafted" or "_machineTranslated" — then run ' +
        '"digit-i18n apply" to see the real upsert payload and send it (only after you confirm), or upload ' +
        "via the existing admin screen yourself."
    );
  }
}

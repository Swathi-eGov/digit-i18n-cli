import config from "../config.js";
import { collectPendingAndDrafted } from "../collectEntries.js";
import { translateEntries } from "../translate.js";
import { ensureFreshData } from "../freshness.js";
import { loadRequestInfo } from "../requestInfo.js";
import { authenticateWithPassword } from "../digitAuth.js";
import { upsertLocalization } from "../api.js";
import { confirm } from "../confirm.js";

// The ONLY command in this tool that ever writes to the backend. Everything
// else (sync excepted, which only ever reads) stays local-only, on purpose.
// Never invoke this from install-hooks/the pre-commit flow — a login and an
// interactive confirmation have no reliable place in a non-interactive git
// hook (see CLAUDE.md's "write path" section and README.md's install-hooks
// docs for the full reasoning).
//
// Authentication, in priority order:
//   1. --request-info-file <path>  — a real, CURRENT authToken + userInfo,
//      copied by hand from a browser session (manual fallback).
//   2. DIGIT_USERNAME / DIGIT_PASSWORD in .env — logs in fresh via
//      POST /user/oauth/token, the SAME method the real DIGIT-Frontend CI
//      pipeline uses (confirmed against the upstream
//      `ci/localization-push-pipeline` branch's pushLocalization.yml /
//      push-localization.js — not guessed). Preferred: never goes stale,
//      no dev-tools copy-paste needed. Deliberately NOT accepted as CLI
//      flags (--username/--password) — a password on the command line
//      ends up in shell history and `ps aux` output; env-only avoids that,
//      matching how the real script does it too.

// Matches the real script's batching — keeps individual upsert calls from
// growing unbounded if a huge number of keys are being applied at once.
const CHUNK_SIZE = 300;

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function groupByModule(entries) {
  const byModule = new Map();
  for (const entry of entries) {
    if (!byModule.has(entry.module)) byModule.set(entry.module, []);
    byModule.get(entry.module).push(entry);
  }
  return byModule;
}

// Strips the review-only bookkeeping fields (source, _needsReview, etc.) —
// none of these are part of the real _upsert schema.
function toRealMessage({ module, locale, code, message }) {
  return { module, locale, code, message };
}

async function resolveRequestInfo({ requestInfoFile, tenantId }) {
  if (requestInfoFile) {
    return loadRequestInfo(requestInfoFile);
  }
  if (config.username && config.password) {
    console.log(`Logging in as "${config.username}" to obtain a fresh authToken...`);
    return authenticateWithPassword({
      username: config.username,
      password: config.password,
      tenantId,
      userType: config.userType,
    });
  }
  throw new Error(
    "No way to authenticate. Either pass --request-info-file <path>, or set DIGIT_USERNAME + " +
      "DIGIT_PASSWORD in .env (the account needs localization-upsert access)."
  );
}

export async function applyCommand({ path: pattern, locale, tenantId, to, maxAge, requestInfoFile, yes, dryRun }) {
  const resolvedTenantId = tenantId || config.tenantId || null;
  if (!resolvedTenantId) {
    console.error("Missing tenantId. Pass --tenant-id or set DIGIT_TENANT_ID in .env.");
    process.exitCode = 1;
    return;
  }

  const targetLocales = to?.length ? to : config.upsertLocales;
  const allLocales = [locale, ...targetLocales.filter((l) => l !== locale)];

  await ensureFreshData({ locale, maxAgeMinutes: maxAge, tenantId });

  console.log(`Collecting pending + drafted entries for source locale "${locale}"...`);
  const { pendingPayload, draftedPayload, unresolvedModule, dynamic } = await collectPendingAndDrafted({
    pattern,
    locale,
  });
  const sourceEntries = [...pendingPayload, ...draftedPayload];

  if (!sourceEntries.length) {
    console.log("Nothing to apply — no pending entries and no missing keys with a resolvable module.");
    return;
  }

  if (unresolvedModule.length) {
    console.log(`\n${unresolvedModule.length} key(s) had an unrecognized module prefix — skipped, not included:`);
    unresolvedModule.forEach(({ key, locations }) => {
      console.log(`  ${key}  (${locations.map((l) => `${l.file}:${l.line ?? "?"}`).join(", ")})`);
    });
  }
  if (dynamic.length) {
    console.log(
      `\nNote: ${dynamic.length} dynamically-built t(...) call site(s) could not be checked — review manually.`
    );
  }

  // Source locale goes as-is; every other locale is machine-translated from it.
  const entriesByLocale = new Map();
  entriesByLocale.set(locale, sourceEntries);

  for (const targetLocale of allLocales) {
    if (targetLocale === locale) continue;
    console.log(`\nTranslating ${sourceEntries.length} entrie(s) into "${targetLocale}"...`);
    const { translated, failed } = await translateEntries(sourceEntries, targetLocale, locale);
    if (failed.length) {
      console.log(`  ${failed.length} entrie(s) failed to translate for ${targetLocale} (skipped, not sent):`);
      failed.forEach((f) => console.log(`      ${f.code}: ${f.error}`));
    }
    entriesByLocale.set(
      targetLocale,
      translated.map((e) => ({ ...e, locale: targetLocale }))
    );
  }

  // One real _upsert call per (module, locale, chunk) — matches how the real
  // API is actually scoped (query params + body both carry a single module +
  // locale, confirmed against a real captured request) and matches the real
  // script's own chunking (300 messages per call) so a large batch can't
  // produce one unbounded request.
  const calls = [];
  for (const [targetLocale, entries] of entriesByLocale) {
    if (!entries.length) continue;
    const byModule = groupByModule(entries);
    for (const [moduleName, moduleEntries] of byModule) {
      for (const messageChunk of chunk(moduleEntries.map(toRealMessage), CHUNK_SIZE)) {
        calls.push({ tenantId: resolvedTenantId, module: moduleName, locale: targetLocale, messages: messageChunk });
      }
    }
  }

  if (!calls.length) {
    console.log("\nNothing to upload — every locale's entries failed to translate or ended up empty.");
    return;
  }

  console.log(`\n${calls.length} _upsert call(s) ready to send:\n`);
  calls.forEach((call, i) => {
    console.log(`--- Call ${i + 1}/${calls.length}: module=${call.module} locale=${call.locale} tenantId=${call.tenantId} ---`);
    console.log(JSON.stringify(call.messages, null, 2));
  });

  if (dryRun) {
    console.log("\n--dry-run passed — nothing was uploaded, no authentication was attempted.");
    return;
  }

  if (!yes) {
    const approved = await confirm(`\nSend all ${calls.length} call(s) to the backend now?`);
    if (!approved) {
      console.log("\nDeclined — nothing was uploaded, no authentication was attempted.");
      return;
    }
  } else {
    console.log("\n--yes passed — skipping the confirmation prompt.");
  }

  // Only authenticate once approval is actually in hand — a login is itself
  // a real backend interaction, so it shouldn't happen just because someone
  // previewed the payload while intending to decline.
  let requestInfo;
  try {
    requestInfo = await resolveRequestInfo({ requestInfoFile, tenantId: resolvedTenantId });
  } catch (err) {
    console.error(`\ndigit-i18n apply: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nSending...");
  let successCount = 0;
  let failCount = 0;
  for (const call of calls) {
    try {
      await upsertLocalization({ ...call, requestInfo });
      console.log(`  [ok] module=${call.module} locale=${call.locale} (${call.messages.length} message(s))`);
      successCount++;
    } catch (err) {
      const status = err.response?.status;
      console.log(`  [FAILED] module=${call.module} locale=${call.locale}: ${status ? `HTTP ${status}` : err.message}`);
      failCount++;
    }
  }

  console.log(`\nDone. ${successCount}/${calls.length} call(s) succeeded.`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

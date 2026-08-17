import fs from "fs";
import { listModules, moduleFilePath } from "./registry.js";
import { getLastSyncedAt } from "./syncMeta.js";
import { syncCommand } from "./commands/sync.js";

function formatAge(minutes) {
  if (minutes < 60) return `${minutes} minute(s)`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hour(s)`;
  return `${Math.round(minutes / (60 * 24))} day(s)`;
}

// Only considers modules that actually have synced data — a module that only
// has pending (add-staged) entries was never synced, so "staleness" doesn't
// apply to it.
export function getStalenessReport(locale) {
  const modules = listModules().filter((m) => fs.existsSync(moduleFilePath(m, locale)));
  return modules.map((moduleName) => {
    const lastSyncedAt = getLastSyncedAt(moduleName, locale);
    const ageMinutes = lastSyncedAt
      ? Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60000)
      : null;
    return { module: moduleName, lastSyncedAt, ageMinutes };
  });
}

// Default (no maxAgeMinutes): warn only, never touch the network — matches
// the "only sync ever talks to the backend, explicitly" rule elsewhere in
// this tool. Opt-in (maxAgeMinutes set): re-sync automatically, but only the
// modules that are actually stale, and only after printing that it's doing so.
export async function ensureFreshData({ locale, maxAgeMinutes, tenantId }) {
  const report = getStalenessReport(locale);
  if (!report.length) return; // nothing synced yet — each command handles that on its own

  const withKnownAge = report.filter((r) => r.ageMinutes !== null);
  const unknownAge = report.filter((r) => r.ageMinutes === null);

  if (maxAgeMinutes) {
    const stale = withKnownAge.filter((r) => r.ageMinutes > maxAgeMinutes);
    if (stale.length) {
      console.log(
        `Local data older than ${maxAgeMinutes} minute(s) for: ${stale
          .map((r) => `${r.module} (${formatAge(r.ageMinutes)} old)`)
          .join(", ")} — syncing before continuing...\n`
      );
      await syncCommand({ modules: stale.map((r) => r.module).join(","), locale, tenantId });
      console.log("");
      return;
    }
  }

  if (unknownAge.length) {
    unknownAge.forEach((r) => {
      console.log(
        `Note: "${r.module}" has synced data with no recorded sync time (synced before this check existed, or file added manually) — age unknown.`
      );
    });
  }
  if (withKnownAge.length) {
    const mostStale = withKnownAge.reduce((a, b) => (b.ageMinutes > a.ageMinutes ? b : a));
    console.log(
      `Local data freshness: oldest is "${mostStale.module}" (last synced ${formatAge(mostStale.ageMinutes)} ago).` +
        (maxAgeMinutes ? "" : " Pass --max-age <minutes> to auto-sync when data is older than that, or re-run sync manually.")
    );
  }
  console.log("");
}

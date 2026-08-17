import { searchLocalization } from "../api.js";
import { writeModuleMessages } from "../registry.js";
import { findWhitespaceDuplicates } from "../dedupe.js";
import { stampSync } from "../syncMeta.js";

export async function syncCommand({ modules, locale, tenantId }) {
  const moduleList = modules
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const localeList = locale
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  let totalKeys = 0;
  let failures = 0;
  let totalAttempts = 0;

  for (const currentLocale of localeList) {
    console.log(`Syncing ${moduleList.length} module(s) for locale "${currentLocale}"...\n`);

    for (const moduleName of moduleList) {
      totalAttempts += 1;
      process.stdout.write(`  ${moduleName} ... `);
      try {
        const messages = await searchLocalization({
          modules: [moduleName],
          locale: currentLocale,
          tenantId,
        });
        const map = {};
        messages.forEach(({ code, message }) => {
          map[code] = message;
        });
        const file = writeModuleMessages(moduleName, currentLocale, map);
        stampSync(moduleName, currentLocale, new Date().toISOString());
        totalKeys += Object.keys(map).length;
        console.log(`${Object.keys(map).length} keys -> ${file}`);

        // Confirmed against real data: the backend can contain keys that are
        // byte-for-byte duplicates except for incidental whitespace. Report
        // these so they're visible every sync, without silently merging or
        // dropping any of the raw records.
        const dupGroups = findWhitespaceDuplicates(messages);
        if (dupGroups.length) {
          console.log(
            `    Note: ${dupGroups.length} whitespace-duplicate key group(s) found in this module's data:`
          );
          dupGroups.forEach(({ normalized, group }) => {
            const variants = group.map((g) => JSON.stringify(g.code)).join(", ");
            console.log(`      "${normalized}"  <-  ${variants}`);
          });
        }
      } catch (err) {
        failures += 1;
        const status = err.response?.status;
        console.log("FAILED");
        console.error(`    ${status ? `HTTP ${status}` : ""} ${err.message}`.trim());
      }
    }

    console.log("");
  }

  console.log(
    `Done. ${totalKeys} total key(s) synced across ${totalAttempts - failures}/${totalAttempts} module/locale combination(s).`
  );
  if (failures > 0) {
    process.exitCode = 1;
  }
}

import { Command } from "commander";
import config from "./config.js";
import { syncCommand } from "./commands/sync.js";
import { searchCommand } from "./commands/search.js";
import { stageCommand } from "./commands/stage.js";
import { lintCommand } from "./commands/lint.js";
import { scanCommand } from "./commands/scan.js";
import { exportCommand } from "./commands/export.js";
import { deadcheckCommand } from "./commands/deadcheck.js";
import { installHooksCommand } from "./commands/installHooks.js";
import { applyCommand } from "./commands/apply.js";

const program = new Command();

program
  .name("digit-i18n")
  .description(
    "DIGIT localization CLI — local registry sync, reuse discovery, naming/duplication\n" +
      "linting, and missing-key detection. Only `sync` reads from the backend automatically.\n" +
      "`apply` is the only command that ever writes to it, and only when you explicitly run it\n" +
      "and confirm — every other command stays local-only. See apply --help / export --help."
  )
  .version("0.1.0");

program
  .command("sync")
  .description("Pull the latest translations from the backend into local localizations/*.json (read-only)")
  .requiredOption(
    "-m, --modules <modules>",
    "comma-separated module tags, e.g. hcm-common,hcm-campaignmanager"
  )
  .option("-l, --locale <locales>", "comma-separated locale(s) to sync, e.g. en_IN,hi_IN,fr_FR", config.defaultLocale)
  .option("-t, --tenant-id <tenantId>", "tenant id (overrides DIGIT_TENANT_ID)")
  .action(async (opts) => {
    await syncCommand({ modules: opts.modules, locale: opts.locale, tenantId: opts.tenantId });
  });

program
  .command("search <query>")
  .description("Fuzzy-search local keys/messages before creating a new one")
  .option("-m, --module <module>", "restrict search to one module")
  .option("-l, --locale <locale>", "locale to search", config.defaultLocale)
  .option("-n, --limit <limit>", "max results to show", (v) => parseInt(v, 10), 10)
  .option("-t, --tenant-id <tenantId>", "tenant id to use if --max-age triggers a re-sync")
  .option("--max-age <minutes>", "auto re-sync stale modules older than this many minutes before searching", (v) => parseInt(v, 10))
  .action(async (query, opts) => {
    await searchCommand(query, opts);
  });

program
  .command("stage <key>")
  .description(
    "Stage a new key locally (formatted as DIGIT_{MODULE}_{KEY}). Local only — never touches the backend. " +
      '(Named like "git add" — stages locally, doesn\'t push/upload anything.)'
  )
  .requiredOption("-m, --module <prefix>", "registered module prefix, e.g. CAMPAIGN or COMMON (see digit-i18n.config.json)")
  .requiredOption("--message <text>", "the message/label text for this key")
  .option("-l, --locale <locale>", "locale to stage this under", config.defaultLocale)
  .action((key, opts) => {
    stageCommand(key, { module: opts.module, message: opts.message, locale: opts.locale });
  });

program
  .command("lint")
  .description(
    "Warn-only check: scans source for t(...) calls and flags naming-convention violations and likely common-module duplicates"
  )
  .option("-p, --path <glob>", "glob of files to scan", "**/*.{js,jsx}")
  .option("-l, --locale <locale>", "locale to check common-module keys against", config.defaultLocale)
  .option("--strict", "exit with a non-zero code if any issue is found (off by default in Phase 2)", false)
  .action(async (opts) => {
    await lintCommand({ path: opts.path, locale: opts.locale, strict: opts.strict });
  });

program
  .command("scan")
  .description("Find keys referenced in code that have no translation anywhere (synced or pending)")
  .option("-p, --path <glob>", "glob of files to scan", "**/*.{js,jsx}")
  .option("-l, --locale <locale>", "locale to check against", config.defaultLocale)
  .option("-t, --tenant-id <tenantId>", "tenant id to use if --max-age triggers a re-sync")
  .option("--max-age <minutes>", "auto re-sync stale modules older than this many minutes before scanning", (v) => parseInt(v, 10))
  .action(async (opts) => {
    await scanCommand({ path: opts.path, locale: opts.locale, tenantId: opts.tenantId, maxAge: opts.maxAge });
  });

program
  .command("export")
  .description(
    "Draft messages for missing keys and write a ready-to-review upload payload. Never calls the backend — " +
      "produces a local file only (that's the whole job of this command, hence the name)."
  )
  .option("-p, --path <glob>", "glob of files to scan", "**/*.{js,jsx}")
  .option("-l, --locale <locale>", "locale to generate the payload for", config.defaultLocale)
  .option("-t, --tenant-id <tenantId>", "tenant id to embed in the payload (overrides DIGIT_TENANT_ID)")
  .option("-o, --out <file>", "output file (default: localizations/export.<locale>.json)")
  .option("--max-age <minutes>", "auto re-sync stale modules older than this many minutes before drafting", (v) => parseInt(v, 10))
  .option(
    "--translate-to <locales>",
    "comma-separated target locale(s) to auto-translate the drafted/pending messages into, e.g. hi_IN,fr_FR,pt_MZ " +
      "(writes a separate export.<locale>.json per target locale; uses a free, unofficial translation " +
      "endpoint — no API key, no SLA)"
  )
  .action(async (opts) => {
    await exportCommand({
      path: opts.path,
      locale: opts.locale,
      tenantId: opts.tenantId,
      out: opts.out,
      maxAge: opts.maxAge,
      translateTo: opts.translateTo
        ? opts.translateTo.split(",").map((l) => l.trim()).filter(Boolean)
        : undefined,
    });
  });

program
  .command("deadcheck")
  .description("Find known keys (synced or pending) that are no longer referenced anywhere in code")
  .option("-p, --path <glob>", "glob of files to scan", "**/*.{js,jsx}")
  .option("-l, --locale <locale>", "locale to check", config.defaultLocale)
  .option("-t, --tenant-id <tenantId>", "tenant id to use if --max-age triggers a re-sync")
  .option("--max-age <minutes>", "auto re-sync stale modules older than this many minutes before checking", (v) => parseInt(v, 10))
  .action(async (opts) => {
    await deadcheckCommand({ path: opts.path, locale: opts.locale, tenantId: opts.tenantId, maxAge: opts.maxAge });
  });

program
  .command("apply")
  .description(
    "Collect pending+drafted messages, machine-translate to every target locale, show you the real _upsert " +
      "payload(s), and — ONLY after you explicitly confirm (or pass --yes) — send them to the backend. The only " +
      "command in this tool that ever writes to the backend. This tool itself never invokes it automatically " +
      "(not the pre-commit hook, not any other command) — it only runs when a human does, or when a CI workflow " +
      "someone has deliberately set up runs it after a reviewed PR merges (see github-workflow.example.yml)."
  )
  .option("-p, --path <glob>", "glob of files to scan", "**/*.{js,jsx}")
  .option("-l, --locale <locale>", "source locale (the one your staged/drafted messages are in)", config.defaultLocale)
  .option("-t, --tenant-id <tenantId>", "tenant id (overrides DIGIT_TENANT_ID)")
  .option(
    "--to <locales>",
    "comma-separated locale(s) to upload to, in addition to the source locale (defaults to DIGIT_UPSERT_LOCALES in .env if omitted)"
  )
  .option(
    "--request-info-file <file>",
    "path to a JSON file with a real, CURRENT authToken + userInfo, copied fresh from your browser session — " +
      "manual fallback. If omitted, logs in itself using DIGIT_USERNAME/DIGIT_PASSWORD from .env (preferred — " +
      "same method the real DIGIT-Frontend CI pipeline uses, never goes stale)."
  )
  .option("--max-age <minutes>", "auto re-sync stale modules older than this many minutes first", (v) => parseInt(v, 10))
  .option("--yes", "skip the confirmation prompt (use with real caution — this is the one command that writes to the backend)", false)
  .option("--dry-run", "show what would be sent and exit — never authenticates, never sends anything", false)
  .action(async (opts) => {
    await applyCommand({
      path: opts.path,
      locale: opts.locale,
      tenantId: opts.tenantId,
      to: opts.to ? opts.to.split(",").map((l) => l.trim()).filter(Boolean) : undefined,
      requestInfoFile: opts.requestInfoFile,
      maxAge: opts.maxAge,
      yes: opts.yes,
      dryRun: opts.dryRun,
    });
  });

program
  .command("install-hooks")
  .description(
    "Install a warn-only pre-commit hook scoped to the current module's path (run this from inside the module folder)"
  )
  .action(() => {
    installHooksCommand();
  });

program.parseAsync(process.argv);

export default program;

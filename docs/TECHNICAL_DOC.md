# digit-i18n-cli — Technical Documentation

This is the complete technical reference for `digit-i18n-cli`. If you're
looking for a quick start, see [README.md](../README.md) instead — this
document goes deeper: full architecture, every command's internal behavior,
every source file's purpose and exports, the full configuration reference,
and known limitations. Read this if you're maintaining, extending, or trying
to fully understand this tool, not just use it.

## Table of contents

1. [The problem](#1-the-problem)
2. [Architecture](#2-architecture)
3. [Installation](#3-installation)
4. [Configuration reference](#4-configuration-reference)
5. [Commands, in full](#5-commands-in-full)
6. [Automatic hooks and CI](#6-automatic-hooks-and-ci)
7. [Complete file reference](#7-complete-file-reference)
8. [Backend API contracts used](#8-backend-api-contracts-used)
9. [Known limitations](#9-known-limitations)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. The problem

See `README.md`'s [The problem](../README.md#the-problem) section — not
repeated here to avoid the two drifting out of sync. In short: DIGIT's
health campaign frontend is built from several independently developed
modules, all reading localized text from one shared backend service, with no
naming convention, no reuse discovery, no local source of truth, silent
missing-translation leaks to the UI, no dead-key cleanup, and manual
spreadsheet-based uploads.

## 2. Architecture

### 2.1 Shape of the solution

A CLI (`digit-i18n`) backed by a local JSON registry that mirrors the
backend and tracks locally-authored work that hasn't reached the backend
yet, plus a pre-commit hook that runs detection automatically, regardless of
how a commit is made (terminal, an IDE's git panel, anything — they all
invoke `git` itself, which is what fires the hook).

```
                 ┌─────────────┐
   backend  ───▶ │    sync     │  (the only read)
                 └──────┬──────┘
                        ▼
              localizations/<module>/<locale>.json   (local mirror)
                        │
        ┌───────────────┼────────────────────┐
        ▼               ▼                    ▼
     search           lint/scan           deadcheck
  (find existing)  (naming + missing)   (unused keys)
                        │
                        ▼
                     export           (drafts + writes a local payload file)
                        │
                        ▼
                     apply            (the only write — human-confirmed)
                        │
                        ▼
                    backend
```

### 2.2 The one rule that holds it together

**Only `sync` reads from the backend automatically. `apply` is the only
command that ever writes to it, and only when a human explicitly runs it and
confirms** (or a CI job runs it non-interactively after a pull request has
already been reviewed and merged — see [§6.3](#63-ci-template-for-apply)).
Every other command (`search`, `stage`, `lint`, `scan`, `export`,
`deadcheck`, `install-hooks`) touches only local files. `search`, `scan`,
`export`, and `deadcheck` can optionally trigger a `sync` themselves via
`--max-age`, but only as an explicit opt-in, and it's still `sync` doing the
actual read.

If you extend this tool: do not add a second code path to the backend
outside `apply`, and do not make `apply` skip its confirmation by default.

### 2.3 The local registry layout

Everything lives under a `localizations/` folder (path configurable via
`DIGIT_LOCALIZATIONS_DIR`), created relative to wherever you invoke the CLI
from:

```
localizations/
  .sync-meta.json                       # last-synced-at per module/locale
  hcm-common/
    en_IN.json                          # synced mirror (sync writes this)
    en_IN.pending.json                  # locally staged, not-yet-uploaded (stage writes this)
  hcm-campaignmanager/
    en_IN.json
    en_IN.pending.json
  export.en_IN.json                     # export's output (upload-ready draft)
  export.hi_IN.json                     # one per --translate-to locale
```

`<locale>.json` is always a pure mirror of the backend — only `sync` ever
writes it. `<locale>.pending.json` holds developer-authored messages staged
via `stage` that haven't reached the backend yet. Keeping these two files
separate is deliberate: `<locale>.json` should always answer "what's
actually live," never silently mixed with local-only additions.

## 3. Installation

### 3.1 Requirements

- Node.js 20 or newer.
- Targets the DIGIT React 19 module layout (`health/micro-ui-react19/web`);
  pure ESM (`"type": "module"` in `package.json`).

### 3.2 Setup

```bash
yarn install
cp .env.example .env
# fill in .env — see §4.1 for every variable

cp digit-i18n.config.example.json digit-i18n.config.json
# register each module you actually work with — see §4.2
```

Run it directly, or link it as a global command:

```bash
yarn link
digit-i18n --help
```

### 3.3 Where you run it from matters

`digit-i18n` reads `.env` and `digit-i18n.config.json` relative to your
**current working directory**, and writes/reads `localizations/` there too.
In a monorepo, that means you should generally run it from inside the
specific module you're working on (e.g. `campaign-manager/`), not the
workspace root — each module gets its own local registry and its own
`.env`/config.

## 4. Configuration reference

### 4.1 Environment variables (`.env`)

| Variable | Required? | Purpose |
|---|---|---|
| `DIGIT_API_BASE_URL` | Yes, for anything that touches the network | Backend base URL, no trailing slash, e.g. `https://unified-dev.digit.org` |
| `DIGIT_TENANT_ID` | Yes (or pass `--tenant-id`) | Tenant to query/write, e.g. `mz` or `pg.citya` |
| `DIGIT_AUTH_TOKEN` | No | Only needed if localization `_search` isn't publicly readable in your environment; sent as `null` if blank |
| `DIGIT_DEFAULT_LOCALE` | No (defaults to `en_IN`) | Locale used when `--locale` isn't passed |
| `DIGIT_LOCALIZATIONS_DIR` | No (defaults to `./localizations`) | Where the local registry lives |
| `DIGIT_UPSERT_LOCALES` | No | Comma-separated default target locales for `apply --to` when `--to` is omitted |
| `DIGIT_USERNAME` / `DIGIT_PASSWORD` | Only for `apply` | Login credentials for the fresh OAuth login `apply` performs — **sensitive, keep `.env` gitignored** |
| `DIGIT_USER_TYPE` | No (defaults to `EMPLOYEE`) | User type sent in the OAuth login body |

Credentials are deliberately **not** accepted as CLI flags — a password on
the command line ends up in shell history and `ps aux` output.

### 4.2 `digit-i18n.config.json`

Maps a short prefix (used with `stage --module <PREFIX>`) to the real
backend module tag, and marks which prefix is the shared "common" module:

```json
{
  "commonModule": "COMMON",
  "modules": {
    "COMMON":   { "backendModule": "hcm-common", "isCommon": true },
    "CAMPAIGN": { "backendModule": "hcm-campaignmanager" },
    "HR":       { "backendModule": "hcm-hr" },
    "PGR":      { "backendModule": "hcm-pgr" },
    "PAYMENTS": { "backendModule": "hcm-am" },
    "DSS":      { "backendModule": "hcm-dss" }
  }
}
```

If no `digit-i18n.config.json` exists in the current directory, `src/config.js`
falls back to the bundled `src/default-modules.config.json` (same shape as
above). Those `backendModule` values are **best-effort guesses**, not
independently confirmed for every module — if `sync` returns 0 keys for a
module, double-check its `backendModule` tag against that module's actual
`moduleCode`.

## 5. Commands, in full

For every command below: source file, exact CLI options, and what happens
internally.

### `sync` — `src/commands/sync.js`

```
digit-i18n sync --modules <m1,m2,...> [--locale <l1,l2,...>] [--tenant-id <id>]
```

For every module × locale combination: calls `searchLocalization()`
(`src/api.js`, read-only `_search`), writes the result to
`localizations/<module>/<locale>.json` via `writeModuleMessages()`
(`src/registry.js`, sorted by key for clean diffs), stamps
`localizations/.sync-meta.json` via `stampSync()` (`src/syncMeta.js`), and
runs `findWhitespaceDuplicates()` (`src/dedupe.js`) against the freshly
synced data to report keys that are byte-identical except for stray
whitespace — a real, confirmed characteristic of the actual backend data.
Exits non-zero if any module/locale combination's API call failed.

### `search <query>` — `src/commands/search.js`

```
digit-i18n search "<query>" [--module <m>] [--locale <l>] [--limit <n>] [--tenant-id <id>] [--max-age <minutes>]
```

Optionally triggers a freshness-gated re-sync (`ensureFreshData()`,
`src/freshness.js`), loads everything known locally via `loadAllMessages()`
(`src/registry.js` — synced entries plus pending entries not already synced),
and fuzzy-matches the query against `code`+`message` using `fuse.js`
(threshold `0.4`). Tags results `[pending, not yet uploaded]` when they only
exist in a `.pending.json` file, and flags whitespace-duplicate siblings via
`findWhitespaceDuplicates()`.

### `stage <key>` — `src/commands/stage.js`

```
digit-i18n stage <KEY> --module <PREFIX> --message "<text>" [--locale <l>]
```

1. Resolves `<PREFIX>` via `resolvePrefix()` (`src/moduleRegistry.js`) — errors out if unregistered.
2. If the raw key is entirely generic words (`looksGeneric()`, `src/naming.js`, checked against the `GENERIC_WORDS` list) and the target module isn't the common one, suggests `--module COMMON` instead (doesn't block).
3. Builds the final key via `buildKey(prefix, rawKey)` → `DIGIT_{PREFIX}_{KEY}` (`src/naming.js`).
4. Fuzzy-checks the message text against everything already known (`fuse.js`, threshold `0.35`) and warns about likely duplicates.
5. Writes to `<module>/<locale>.pending.json` via `addPendingEntry()` (`src/registry.js`) — **never touches the backend.**

### `lint` — `src/commands/lint.js`

```
digit-i18n lint [--path <glob>] [--locale <l>] [--strict]
```

Uses `findSourceFiles()` + `scanFilesForKeys()` (`src/scanner.js`) to extract
every `t(...)` call site, then for each unique key:
- Flags it if `isValidKeyFormat()` (`src/naming.js`) fails (not `DIGIT_{MODULE}_{KEY}`).
- Otherwise, if it's not already a common-module key, compares its suffix (`keySuffixTokens()`) against every known common-module key's suffix — a match means "you probably meant to reuse the common key."

Reports dynamically-built call sites separately (see [§9](#9-known-limitations)).
`--strict` (off by default) sets `process.exitCode = 1` if any issue is found.

### `scan` — `src/commands/scan.js`

```
digit-i18n scan [--path <glob>] [--locale <l>] [--tenant-id <id>] [--max-age <minutes>]
```

Calls `computeMissingKeys()` (`src/missingKeys.js`), which combines the
scanner's output with `loadAllMessages()` and reports every key referenced in
code with no message anywhere (synced or pending), whitespace-normalized on
both sides (`normalizeKey()`, `src/dedupe.js`) so a backend key with stray
whitespace doesn't wrongly look "missing." Read-only, writes nothing.

### `export` — `src/commands/export.js`

```
digit-i18n export [--path <glob>] [--locale <l>] [--tenant-id <id>] [--out <file>] [--max-age <minutes>] [--translate-to <l1,l2,...>]
```

Calls `collectPendingAndDrafted()` (`src/collectEntries.js`), which:
- Reads every module's `<locale>.pending.json` as-is (`source: "pending"`).
- For every key `computeMissingKeys()` finds, resolves its backend module via `resolveBackendModule()` and drafts a message via `draftMessage()` (title-cased key suffix), tagging it `source: "drafted"` and `_needsReview: true`.

Writes the combined result to `localizations/export.<locale>.json`, grouped
per module in the real `_upsert` body shape (see [§8](#8-backend-api-contracts-used)).
With `--translate-to`, calls `translateEntries()` (`src/translate.js`) once
per target locale and writes a separate `export.<locale>.json` for each,
tagging every entry `_machineTranslated: true` and
`_translatedFrom: "<source>"`. **Never calls the backend** — this command
only ever writes local files.

### `deadcheck` — `src/commands/deadcheck.js`

```
digit-i18n deadcheck [--path <glob>] [--locale <l>] [--tenant-id <id>] [--max-age <minutes>]
```

The inverse of `scan`: loads every known key (`loadAllMessages()`) and every
key actually referenced in code (`scanFilesForKeys()`), and reports the known
keys that aren't referenced anywhere (whitespace-normalized comparison).
Never deletes anything — a report only. See [§9](#9-known-limitations) for
the dynamic-key false-positive caveat.

### `apply` — `src/commands/apply.js`

```
digit-i18n apply [--path <glob>] --locale <l> [--tenant-id <id>] [--to <l1,l2,...>] [--request-info-file <path>] [--max-age <minutes>] [--yes] [--dry-run]
```

The only command that writes to the backend. Sequence:
1. Requires a resolved `tenantId` (flag or `.env`) — exits 1 if missing.
2. Collects pending+drafted entries for the source `--locale` via `collectPendingAndDrafted()` (same function `export` uses).
3. Translates them into every target locale (`--to`, or `DIGIT_UPSERT_LOCALES` if `--to` is omitted) via `translateEntries()`.
4. Groups by `(module, locale)` and chunks each group at 300 messages (`CHUNK_SIZE`) — matches the real DIGIT-Frontend CI script's own batching.
5. Prints every real `_upsert` call it's about to make, in full.
6. **`--dry-run` stops here** — no authentication attempted, nothing sent.
7. Otherwise asks `y/n` (`confirm()`, `src/confirm.js`) unless `--yes` is passed.
8. **Only after approval**, resolves a `RequestInfo` via `resolveRequestInfo()`:
   - `--request-info-file <path>` → `loadRequestInfo()` (`src/requestInfo.js`), a manually-provided real `authToken`+`userInfo`.
   - Otherwise, `DIGIT_USERNAME`/`DIGIT_PASSWORD` → `authenticateWithPassword()` (`src/digitAuth.js`), a fresh OAuth password-grant login.
9. Sends each chunk via `upsertLocalization()` (`src/api.js`). Per-call failures are caught individually and don't stop the rest of the batch; `process.exitCode = 1` if any call failed.

### `install-hooks` — `src/commands/installHooks.js`

```
cd <a-module-folder-inside-a-git-repo>
digit-i18n install-hooks
```

Finds the git root (`findGitRoot()`, walks upward looking for `.git`),
refuses if the current directory *is* the git root (scoping to the whole
repo defeats the point), then writes/updates `.githooks/pre-commit` with a
block scoped to the relative path, and runs
`git config core.hooksPath .githooks` for the current clone (local config,
not shared by cloning/pulling). See [§6](#6-automatic-hooks-and-ci) for the
generated hook's exact behavior.

## 6. Automatic hooks and CI

### 6.1 The generated pre-commit hook

For each scoped module, the hook runs:

```sh
(cd "$SCOPE" && node <cli-entry> lint && node <cli-entry> scan && node <cli-entry> export)
```

only if the commit has staged files under that module's path, and the whole
file unconditionally ends in `exit 0` — a commit is **never** blocked,
regardless of what any of these three report. `export` runs without
`--translate-to` (translating on every WIP commit would be wasteful and
noisy). `apply` is never part of this chain, anywhere.

Both `node` and the CLI entry script are baked in as **absolute paths**
resolved at install time (`process.execPath` and
`path.resolve(__dirname, "../../bin/digit-i18n.js")`), because git hooks run
in a minimal, non-interactive shell that doesn't source `.bashrc`/`.profile`
— a `PATH`-based `node`/`digit-i18n` lookup fails in that environment even
though both work fine interactively.

### 6.2 Automatic installation via `postinstall`

`bin/postinstall-hook.js` runs whenever `digit-i18n-cli` is installed as a
real dependency (this is inert under `yarn link`, which doesn't trigger
lifecycle scripts at all). It does **not** trust `INIT_CWD` (the directory
an install was invoked from) as the hook's scope, because in an npm/yarn
**workspace**, install is normally run once from the workspace root, not
from inside whichever package actually depends on `digit-i18n-cli` — that
would make `INIT_CWD` point at the wrong folder. Instead it:

1. Finds the git root from `INIT_CWD` (`findGitRoot()`, exported from `src/commands/installHooks.js`).
2. Globs every `package.json` under that root (excluding `node_modules`).
3. For each one that lists `"digit-i18n-cli"` in `dependencies`/`devDependencies`, runs `installHooksCommand({ cwd: thatDirectory })`.
4. Falls back to `INIT_CWD` only if no declaring `package.json` is found at all.

Wrapped so it can **never fail the consumer's install** — every scoped
target is in its own try/catch, and `process.exitCode` is reset to `0`
unconditionally at the end. Known limitation: `--ignore-scripts`
environments skip this entirely (falls back to manual `install-hooks`).

### 6.3 CI template for `apply`

`github-workflow.example.yml` is a template (not wired into any real repo
automatically) that runs `npx digit-i18n apply --yes` on push to configured
branches. Copy it to a consuming repo's `.github/workflows/`, edit the
`branches:` list and `MODULE_PATH`/matching `paths:` filter, and configure 5
GitHub Actions secrets: `DIGIT_API_BASE_URL`, `DIGIT_TENANT_ID`,
`DIGIT_USERNAME`, `DIGIT_PASSWORD`, `DIGIT_UPSERT_LOCALES`.

The design rationale: reaching a configured branch (typically via a merged
PR) already required a human to review the committed
`localizations/export.*.json` diff — that review substitutes for the
interactive confirmation `apply` would otherwise require, which is why
`--yes` is safe specifically in this context. One honest caveat: this step
re-derives the payload fresh at merge time rather than replaying the
committed export file byte-for-byte — see the file's own inline comments
for the full detail on what that does and doesn't affect.

If any `_upsert` call in the batch fails, `apply` exits non-zero
(`process.exitCode = 1`), which fails the GitHub Actions step/job/run by
default (no `continue-on-error` is set anywhere in the template).

## 7. Complete file reference

### `bin/`

| File | Purpose |
|---|---|
| `digit-i18n.js` | The executable entrypoint (`package.json`'s `bin` field). Just imports `src/cli.js`, which does all the work as an import-time side effect. |
| `postinstall-hook.js` | Runs on real dependency installs — see [§6.2](#62-automatic-installation-via-postinstall). |

### `src/` — core

| File | Exports | Purpose |
|---|---|---|
| `cli.js` | (none — runs `program.parseAsync()` as a side effect) | Commander wiring: registers all 9 commands, their options, and dispatches to each command's implementation. |
| `config.js` | `config` (default export) | Loads `.env` (via `dotenv`) and `digit-i18n.config.json` (or the bundled fallback), and exposes every setting described in [§4.1](#41-environment-variables-env). |
| `moduleRegistry.js` | `listPrefixes`, `resolvePrefix`, `getCommonPrefix`, `getCommonEntry` | Thin lookups into `config.moduleRegistry` — prefix → `{ backendModule, isCommon }`. |
| `naming.js` | `slugify`, `buildKey`, `isValidKeyFormat`, `keySuffixTokens`, `GENERIC_WORDS`, `looksGeneric` | Key formatting/validation: builds and checks the `DIGIT_{MODULE}_{KEY}` convention, and the common-module nudge heuristic. |
| `scanner.js` | `findSourceFiles`, `scanFileForKeys`, `scanFilesForKeys` | The shared AST-based code scanner (Babel parser + traverse) used by `lint`, `scan`, and `deadcheck`. Recognizes `t("KEY")` and `t(CONST.PATH)`; reports anything else as dynamic. |
| `keyConstantsResolver.js` | `buildImportMap`, `resolveMemberExpressionKey` | Resolves `t(I18N_KEYS.PAGES.SOME_KEY)`-style calls by parsing the imported file and reading the actual assigned string — never guesses from the property name. Caches parsed constants per file. |
| `api.js` | `searchLocalization`, `upsertLocalization` | The backend HTTP client. `searchLocalization` is read-only (`_search`). `upsertLocalization` is the **only** function in the tool that writes to the backend — takes a fully-formed `requestInfo`, never reads credentials itself. |
| `registry.js` | `moduleFilePath`, `modulePendingFilePath`, `readModuleMessages`, `writeModuleMessages`, `readModulePending`, `writeModulePending`, `addPendingEntry`, `listModules`, `loadAllMessages` | All local-file read/write for the `localizations/` registry — both the synced mirror and the pending/staged files. |
| `dedupe.js` | `normalizeKey`, `findWhitespaceDuplicates` | Whitespace-normalized key comparison — real backend data contains keys that differ only by incidental leading/trailing whitespace. |
| `syncMeta.js` | `stampSync`, `getLastSyncedAt` | Reads/writes `localizations/.sync-meta.json`, tracking per-module/locale last-synced time. |
| `freshness.js` | `getStalenessReport`, `ensureFreshData` | The opt-in `--max-age` auto-resync gate shared by `search`, `scan`, `export`, `deadcheck`, `apply`. Never touches the network unless `maxAgeMinutes` is passed. |
| `missingKeys.js` | `computeMissingKeys` | Combines the scanner with `loadAllMessages` to find keys referenced in code with no message anywhere — used by `scan` and `export`. |
| `collectEntries.js` | `draftMessage`, `resolveBackendModule`, `collectPendingAndDrafted` | Shared by `export` and `apply`: collects pending (`stage`-authored) entries plus auto-drafted entries for missing keys. |
| `translate.js` | `localeToLangCode`, `translateText`, `translateEntries` | Free/unofficial machine translation (`google-translate-api-x`), sequential with a small delay, per-entry failure handling. Used by `export --translate-to` and `apply`. |
| `digitAuth.js` | `authenticateWithPassword` | OAuth password-grant login for `apply`, adopted directly from DIGIT-Frontend's own CI pipeline logic. |
| `requestInfo.js` | `loadRequestInfo` | Loads the `--request-info-file` manual-auth fallback for `apply`. |
| `confirm.js` | `confirm` | Blocking yes/no terminal prompt via `readline`, used only by `apply`. |

### `src/commands/` — one file per CLI command

| File | Exports | Command |
|---|---|---|
| `sync.js` | `syncCommand` | `sync` |
| `search.js` | `searchCommand` | `search` |
| `stage.js` | `stageCommand` | `stage` |
| `lint.js` | `lintCommand` | `lint` |
| `scan.js` | `scanCommand` | `scan` |
| `export.js` | `exportCommand` | `export` |
| `deadcheck.js` | `deadcheckCommand` | `deadcheck` |
| `apply.js` | `applyCommand` | `apply` |
| `installHooks.js` | `installHooksCommand`, `findGitRoot` | `install-hooks` (and reused by `bin/postinstall-hook.js`) |

### Root-level files

| File | Purpose |
|---|---|
| `package.json` | Package metadata, dependencies, and the `postinstall` script wiring `bin/postinstall-hook.js`. |
| `.env.example` | Template for `.env` — copy and fill in per [§4.1](#41-environment-variables-env). |
| `digit-i18n.config.example.json` | Template for `digit-i18n.config.json` — copy and register your modules per [§4.2](#42-digit-i18nconfigjson). |
| `src/default-modules.config.json` | The bundled fallback module registry used when no `digit-i18n.config.json` exists in the current directory. |
| `request-info.example.json` | Template for `apply --request-info-file`. |
| `github-workflow.example.yml` | GitHub Actions template — see [§6.3](#63-ci-template-for-apply). |
| `commands/` | Copy-in Claude Code slash command templates (`/i18n-sync`, `/i18n-search`, etc.), one `.md` per CLI command, plus `commands/README.md` with setup instructions. Thin wrappers only — no logic lives here, each one just shells out to the real CLI. `/i18n-apply` always forces `--dry-run` and will not send anything from a chat session. |
| `README.md` | Quick-start overview and command reference. |
| `docs/TECHNICAL_DOC.md` | This file. |
| `docs/PLAN.md` | The original proposal doc — archived for historical context, not a live reference. |

## 8. Backend API contracts used

Both confirmed directly against real DIGIT-Frontend traffic, not guessed.

**Read (`sync`, and internally by `search`/`scan`/`export`/`deadcheck` via
the local registry they populate):**
```
POST /localization/messages/v1/_search?tenantId=...&module=...&locale=...
Body: { "RequestInfo": { "apiId": "Rainmaker", "authToken": <token-or-null>, ... } }
Response: { "messages": [{ "code", "message", "module", "locale" }, ...] }
```

**Write (`apply`, exclusively):**
```
POST /localization/messages/v1/_upsert?tenantId=...&module=...&locale=...
Body: {
  "RequestInfo": { "apiId", "authToken", "userInfo", "msgId", "plainAccessRequest" },
  "tenantId", "module", "locale",
  "messages": [{ "code", "message", "module", "locale" }, ...]
}
```

**Login (`apply`'s default auth path, adopted from DIGIT-Frontend's real CI
pipeline script):**
```
POST /user/oauth/token
Headers: Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=  (standard DIGIT public client id, empty secret)
Body (form-encoded): grant_type=password&scope=read&username&password&tenantId&userType
Response: { access_token, UserRequest }
```

## 9. Known limitations

These are real, deliberate, and documented — not bugs waiting to be fixed
silently.

- **Dynamic key detection is fundamentally incomplete.** Anything built from
  a runtime value — a template literal with a variable, a computed member
  access, an import that can't be statically resolved — cannot be checked by
  `lint`/`scan`/`deadcheck`. These are always reported explicitly as a
  coverage gap, never silently dropped, but they are a real, permanent blind
  spot for static analysis. A runtime `missingKeyHandler` (e.g. i18next's)
  in the consuming app is the complementary, non-static safety net for this
  gap — not something this tool can provide itself.
- **`deadcheck` can false-positive** on a key that's *only* ever referenced
  via a dynamic call site, since its exact key can't be resolved statically.
  It reports every dynamic site it found alongside the dead-key list
  specifically so this can be cross-checked before removing anything.
- **`apply`'s live write path has never been exercised against a real DIGIT
  backend.** By design — testing it safely would mean writing real data to
  a shared system. What's verified: payload construction, chunking, the
  confirmation/`--yes`/`--dry-run` logic, and the login's *failure* path
  (real HTTP status + body surfaced on a bad login). Not verified: an actual
  successful login and a successful upsert landing in a real backend.
- **Translation is via a free, unofficial endpoint** (`google-translate-api-x`)
  — no API key, no SLA, can be rate-limited or blocked without notice. Every
  machine-translated entry is tagged `_machineTranslated`/`_needsReview` for
  exactly this reason. Not something to depend on for a production pipeline
  without switching to an official API later.
- **Hook scoping depends on where the dependency is declared.** The
  postinstall scan scopes a hook to whichever directory's `package.json`
  actually lists `digit-i18n-cli`. Declaring it at a workspace root instead
  of a specific module scopes the hook to that entire root, not to one
  module — there's no smarter per-module auto-detection beyond that.
- **`--ignore-scripts` environments** skip the automatic postinstall hook
  setup entirely (common in CI, or teams that disable lifecycle scripts) —
  falls back to running `digit-i18n install-hooks` manually.
- **The CI template re-derives the `apply` payload fresh at merge time**
  rather than literally replaying the committed `export.*.json` file.
  Human-authored (`stage`) entries are committed text, so those match
  exactly what was reviewed; machine-translated entries are re-translated,
  so their exact wording could differ slightly from what was in the PR diff.

## 10. Troubleshooting

**`sync` returns 0 keys for a module.** Double-check that module's
`backendModule` tag in `digit-i18n.config.json` against its real
`moduleCode`/module prefix in the actual backend — the bundled defaults are
best-effort guesses, not confirmed for every module.

**A pre-commit hook isn't running.** Confirm `git config core.hooksPath`
points at `.githooks` for your clone (`git config core.hooksPath`) — this is
local config, not shared by cloning or pulling, so every developer needs to
run `digit-i18n install-hooks` (or get it via a real dependency install)
themselves once.

**`apply` says "No way to authenticate."** Either set
`DIGIT_USERNAME`+`DIGIT_PASSWORD` in `.env`, or pass
`--request-info-file <path>` pointing at a JSON file with a current, real
`authToken`+`userInfo` (see `request-info.example.json`).

**A translation call fails.** Expected occasionally — the translation
endpoint is free/unofficial with no SLA. Check the `failed` list printed by
`export`/`apply`; a failed entry is skipped, not silently dropped, and
doesn't stop the rest of the batch.

**A key still shows up as "missing" after `stage`-ing it.** Confirm the
locale matches — `stage --locale` and `scan --locale` must agree, and
`export`/`apply` read the same `--locale` you staged under.

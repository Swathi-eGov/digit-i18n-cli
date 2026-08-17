# digit-i18n-cli

Localization tooling for the DIGIT frontend ecosystem — a local-first CLI that
gives every module a naming convention, a searchable local registry, automatic
missing/dead-key detection, and a safe, human-confirmed way to actually get
new keys into the backend.

> **Status:** not published to a package registry yet. Install it locally
> (see [Setup](#setup)) or via `yarn link` for now.
>
> This README is a quick-start overview. For the complete technical
> reference — full architecture, every command's internal behavior, every
> source file's exports, the full configuration reference, and known
> limitations — see **[DOCUMENTATION.md](DOCUMENTATION.md)**.

## Table of contents

- [The problem](#the-problem)
- [How this solves it](#how-this-solves-it)
- [Requirements](#requirements)
- [Setup](#setup)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Data freshness](#data-freshness--nothing-auto-syncs-by-default)
- [Automatic setup (pre-commit hook)](#automatic-setup-once-this-is-a-real-dependency)
- [CI template for `apply`](#github-workflowexampleyml--ci-template-for-apply)
- [Supported `t(...)` call patterns](#supported-t-call-patterns)
- [Design rule](#design-rule-do-not-violate-when-extending-this)
- [Project layout](#project-layout)
- [Roadmap](#roadmap)
- [License](#license)

## The problem

Across DIGIT's health campaign frontend, localization keys are managed
independently by each module with no shared tooling. In practice that means:

- **No naming convention** — keys get named however a developer feels like it.
- **No reuse discovery** — the same message ("Save", "Submit", "Cancel") gets
  re-created under a dozen different keys because there's no easy way to
  check "does this already exist" before typing a new one.
- **No local source of truth** — the only place to see what keys/messages
  exist is the live backend; there's no offline registry to search or reason
  about.
- **Missing translations silently reach the UI** — if code references a key
  with no message anywhere, the UI renders the raw key string to real users,
  and nobody finds out until QA or a user reports it.
- **Dead keys never get cleaned up** — a key gets removed from code but stays
  in the backend forever.
- **Manual, error-prone uploads** — the only way to get new keys into the
  backend has been hand-editing spreadsheets or manually calling the admin
  screen/Postman.

## How this solves it

A CLI (`digit-i18n`) backed by a local JSON registry (`localizations/`, living
inside whichever module you run it from) that mirrors the backend and tracks
work that hasn't been uploaded yet — plus a pre-commit hook that runs
detection automatically on every commit, regardless of how you commit
(terminal, IDE, anything — they all go through git itself).

One rule holds everything together:

**Only `sync` reads from the backend automatically. `apply` is the only
command that ever writes to it, and only when a human explicitly runs it and
confirms** (or a CI job runs it after a pull request has already been
reviewed — see the [CI template](#github-workflowexampleyml--ci-template-for-apply)).
Every other command (`search`, `stage`, `lint`, `scan`, `export`, `deadcheck`,
`install-hooks`) is local-only, full stop.

Mapped directly against the problems above:

| Problem | Solved by |
|---|---|
| No naming convention | `stage` enforces `DIGIT_{MODULE}_{KEY}`; `lint` flags anything that doesn't match it |
| No reuse discovery | `search` — fuzzy-matches your wording against everything already known before you create a new key |
| No local source of truth | `sync` — pulls the real backend into a local, searchable `localizations/` registry |
| Missing translations silently reaching the UI | `scan` detects them, `export` drafts a fix, and `install-hooks` runs both automatically on every commit |
| Dead keys never cleaned up | `deadcheck` — lists keys no longer referenced anywhere in code |
| Manual, error-prone uploads | `apply` — builds the real payload and uploads it safely, only after a human (or a reviewed PR, via the [CI template](#github-workflowexampleyml--ci-template-for-apply)) confirms |

## Requirements

- **Node.js 20+**
- Targets the DIGIT React 19 stack (`health/micro-ui-react19/web`) and its
  module layout; pure ESM.

## Setup

```bash
yarn install
cp .env.example .env
# then fill in .env:
#   DIGIT_API_BASE_URL=https://<your-digit-backend>
#   DIGIT_TENANT_ID=<your tenant, e.g. mz or pg.citya>
#   DIGIT_AUTH_TOKEN=   (leave blank unless your environment requires one for reads)

cp digit-i18n.config.example.json digit-i18n.config.json
# then edit digit-i18n.config.json: register each module you actually work with,
# and its real backendModule tag (the bundled defaults are best-effort guesses,
# not confirmed for every module — see the file's _comment).
```

Optionally link it as a global command for convenience:

```bash
yarn link
digit-i18n --help
```

## Quick start

A typical first run, from inside a specific module folder:

```bash
# 1. Pull down what already exists so you can search/lint against real data
digit-i18n sync --modules hcm-common,hcm-campaignmanager --locale en_IN

# 2. Before creating a new key, check whether something close already exists
digit-i18n search "save changes"

# 3. Stage a genuinely new key locally (never touches the backend)
digit-i18n stage CONFIRM_DELETE_MESSAGE --module CAMPAIGN --message "Are you sure you want to delete this?"

# 4. Check your code for naming issues and likely duplicates
digit-i18n lint

# 5. Find any key referenced in code with no message anywhere
digit-i18n scan

# 6. Turn what "stage" and "scan" found into a ready-to-review upload file
digit-i18n export

# 7. Preview exactly what would be uploaded — no network calls at all
digit-i18n apply --dry-run

# 8. Wire steps 4-6 into a pre-commit hook so they run automatically from now on
digit-i18n install-hooks
```

## Commands

### `sync` — pull translations from the backend into a local registry

```bash
digit-i18n sync --modules hcm-common,hcm-campaignmanager --locale en_IN
digit-i18n sync --modules hcm-common,hcm-campaignmanager --locale en_IN,hi_IN,fr_FR
```

`--locale` accepts a comma-separated list — loops over every module/locale
combination, so `2 modules × 3 locales` syncs 6 times, each writing its own
`localizations/<module>/<locale>.json`.

Writes one JSON file per module into `./localizations/<module>/<locale>.json`,
e.g.:

```
localizations/
  hcm-common/
    en_IN.json
  hcm-campaignmanager/
    en_IN.json
```

Each file is a flat `{ "CODE": "message", ... }` map, sorted by key so diffs
are clean. This is the local mirror of the backend registry — the "single
source of truth" the rest of the tool (and developers) search against.

If the freshly-synced data contains keys that are duplicates of each other
except for incidental whitespace (this happens on real backend data), `sync`
reports each group so it's visible immediately rather than discovered later.

`sync` also stamps a `localizations/.sync-meta.json` file with the time each
module/locale was last pulled — this is what powers the freshness checks
described below. It's bookkeeping, not translation content.

Options:
- `-m, --modules <modules>` (required) — comma-separated module tags
- `-l, --locale <locale>` — defaults to `DIGIT_DEFAULT_LOCALE` (or `en_IN`)
- `-t, --tenant-id <tenantId>` — overrides `DIGIT_TENANT_ID` from `.env`

### `search` — check for an existing key before creating a new one

```bash
digit-i18n search "save"
digit-i18n search "not applicable" --module hcm-common
```

Fuzzy-matches your query against every locally synced module's codes and
messages (via `fuse.js`), so wording differences (e.g. "N/A" vs "Not
Applicable") still surface likely matches. Run `sync` first — `search`
only ever reads the local files, it never calls the backend itself.

Options:
- `-m, --module <module>` — restrict to one module
- `-l, --locale <locale>` — defaults to `DIGIT_DEFAULT_LOCALE` (or `en_IN`)
- `-n, --limit <limit>` — max results shown (default 10)

Results are tagged `[pending, not yet uploaded]` when they only exist in a
local `stage`-staged file, not yet in the synced backend copy. Results are
also tagged when a whitespace-variant duplicate exists for that same key
(confirmed against real backend data) — e.g. a key and that same key with a
stray trailing space both existing as separate backend records.

### `stage` — stage a new key locally (never touches the backend)

```bash
digit-i18n stage SAVE_BUTTON --module CAMPAIGN --message "Save"
```

- Formats the key as `DIGIT_{MODULE}_{KEY}` (e.g. `DIGIT_CAMPAIGN_SAVE_BUTTON`) using the prefix -> `backendModule` mapping in `digit-i18n.config.json`.
- If the raw key looks like a generic/common concept (SAVE, CANCEL, EDIT, ...), it suggests using `--module COMMON` instead so other modules can reuse it — doesn't block, just nudges.
- Fuzzy-checks the message against everything already known locally (synced + pending) and warns about likely existing matches before you create a duplicate.
- Writes only to a local `<module>/<locale>.pending.json` file — **never calls the backend.** `export` turns accumulated pending entries into a ready-to-review upload payload.

Options:
- `-m, --module <prefix>` (required) — a prefix registered in `digit-i18n.config.json`
- `--message <text>` (required) — the label/message text
- `-l, --locale <locale>` — defaults to `DIGIT_DEFAULT_LOCALE` (or `en_IN`)

### `lint` — warn-only naming and duplication check

```bash
digit-i18n lint
digit-i18n lint --path "packages/modules/campaign-manager/src/**/*.{js,jsx}"
digit-i18n lint --strict   # exits 1 if any issue is found — for CI use
```

Scans source files for `t(...)` call sites (via `@babel/parser`/`@babel/traverse`, not regex — this correctly finds calls inside JSX/template code) and reports:
- **Naming convention violations** — any key not matching `DIGIT_{MODULE}_{KEY}`.
- **Likely duplicates of a common-module key** — e.g. `DIGIT_CAMPAIGN_SAVE` when `DIGIT_COMMON_SAVE` already exists (compares the key's suffix after the module segment, not the message text).
- **Dynamically-built keys it could not check at all** — e.g. `` t(`DSS_${var}`) `` — reported explicitly as a coverage gap, not silently skipped. This is a fundamental limitation of static scanning, not a bug — a runtime `missingKeyHandler` (e.g. i18next's) in the consuming app is the complementary, non-static safety net for this gap.

Non-blocking by default (`--strict` off) — intentional: get the check's
accuracy proven on real code before it can fail anyone's build.

Options:
- `-p, --path <glob>` — files to scan (default `**/*.{js,jsx}`)
- `-l, --locale <locale>` — which locale's common-module keys to compare against
- `--strict` — exit 1 if any issue is found (reserved for CI, once ready)

### `scan` — find keys with no translation anywhere

```bash
digit-i18n scan
```

Scans source the same way `lint` does, but with a different question: for
every unique key referenced in code, does it already have a message —
**either synced from the backend or staged locally via `stage`**? If not, it's
reported as missing, grouped by key with every file:line it was found at.
Also reports dynamically-built keys it can't resolve, same as `lint`.

This never touches the backend and never writes anything — it's a report
only. Follow it with `export` to actually generate something usable.

Options:
- `-p, --path <glob>` — files to scan (default `**/*.{js,jsx}`)
- `-l, --locale <locale>` — locale to check against

### `export` — draft messages and output a ready-to-review upload payload

```bash
digit-i18n export --tenant-id mz
digit-i18n export --out my-payload.json
```

By default, writes to `localizations/export.<locale>.json` — alongside the synced/pending mirrors and `.sync-meta.json`, so everything this tool manages stays in one place. `--out` overrides this and is resolved relative to your current directory instead.

Combines two sources into one JSON file:
1. **Every pending entry** already staged via `stage` — these already have a real, developer-authored message, so they're included as-is (`"source": "pending"`).
2. **Every key `scan` finds with no message anywhere** — these get an auto-drafted message (deterministic: title-cased from the key's suffix tokens, e.g. `DIGIT_CAMPAIGN_CONFIRM_DELETE_MESSAGE` -> "Confirm Delete Message"). Each drafted entry is marked `"source": "drafted"` and `"_needsReview": true`, with `"_foundAt"` listing where it was used in code — **this is a rule-based MVP heuristic, not real context-aware drafting, and must be reviewed before use.**

The output is grouped per module, matching the real `_upsert` request-body shape:
```json
[
  {
    "tenantId": "demo",
    "module": "hcm-campaignmanager",
    "locale": "en_DEMO",
    "messages": [
      { "module": "hcm-campaignmanager", "locale": "en_DEMO", "code": "...", "message": "...", "source": "pending" }
    ]
  }
]
```
Each array element is directly usable as one real `_upsert` call for that module — except `source`/`_needsReview`/`_foundAt`, which are extra fields added purely for the human reviewing this file (so drafted-vs-authored entries stay distinguishable) and aren't part of the real schema; strip them before actually sending anything.

Keys whose module prefix isn't registered in `digit-i18n.config.json` are reported separately and excluded from the payload (there's no backend module tag to attach them to). Dynamically-built keys are reported the same way `scan` reports them.

**This command never calls the backend.** It only writes a local JSON file — applying it (via `apply`, the existing admin screen, or your own `_upsert` call) is a deliberate, separate, manual step.

Options:
- `-p, --path <glob>` — files to scan (default `**/*.{js,jsx}`)
- `-l, --locale <locale>` — locale to generate the payload for
- `-t, --tenant-id <tenantId>` — embedded in each payload entry (overrides `DIGIT_TENANT_ID`)
- `-o, --out <file>` — output path (default `localizations/export.<locale>.json`)
- `--translate-to <locales>` — auto-translate into other languages, see below

#### Multi-language auto-translation (`export --translate-to`)

```bash
digit-i18n export --tenant-id mz --translate-to hi_IN,fr_FR,pt_MZ
```

Once the English (or whatever `--locale` you ran with) messages exist —
either developer-authored via `stage`, or auto-drafted for missing keys —
this translates every one of them into each target locale and writes a
**separate** `localizations/export.<locale>.json` per language,
in the same real `_upsert`-shaped format as the source-locale file.

- Uses a **free, unofficial** Google Translate endpoint (`google-translate-api-x`,
  no API key needed) — confirmed working with real translations during
  development (e.g. "Save Changes" → "परिवर्तनों को सुरक्षित करें" / "Enregistrer les modifications").
  **This is explicitly not an officially supported API** — no SLA, can be
  rate-limited or blocked without notice. Fine for drafting review candidates;
  not something to depend on for a production pipeline without switching to
  a real API (Google Cloud Translation, DeepL, etc.) later.
- Every translated entry is tagged `"_machineTranslated": true` and
  `"_translatedFrom": "<source locale>"`, **in addition to** `_needsReview`
  — machine-translated UI strings need human review more than the English
  draft does, not less.
- Translation happens sequentially with a small delay between calls (not
  in parallel) — reduces the chance of hitting rate limits on the
  unofficial endpoint.
- **Failures are handled per-entry, not fatal to the whole run** — if a
  specific locale code isn't supported or a single translation call fails,
  that entry is skipped (reported, not silently dropped) and everything
  else still gets written.
- The source locale itself is automatically skipped if it appears in
  `--translate-to` (nothing to translate into itself).

### `apply` — the only command that ever writes to the backend

```bash
digit-i18n apply --tenant-id mz --locale en_IN --to hi_IN,fr_FR,pt_MZ
digit-i18n apply --locale en_IN --dry-run           # preview only, never authenticates or sends
digit-i18n apply --locale en_IN --yes               # skip the confirmation prompt
```

Everything else in this tool stays local-only. `apply` exists because a
real, end-to-end workflow needs a final step that actually uploads — but
that step is deliberately never automatic. It:

1. Collects pending (`stage`-authored) and drafted (`export`-style) entries for the source `--locale`.
2. Machine-translates them into every target locale (`--to`, or `DIGIT_UPSERT_LOCALES` from `.env` if `--to` is omitted).
3. Prints every real `_upsert` call it's about to make, in full.
4. **With `--dry-run`: stops right here.** No authentication is attempted, nothing is sent.
5. Otherwise, asks for an explicit `yes`/`no` confirmation (skippable with `--yes` — intended for CI, where the confirmation was already effectively given by a reviewed & merged PR — see the [CI template](#github-workflowexampleyml--ci-template-for-apply)).
6. **Only after approval** does it authenticate, and only then does it send.

**Authentication — adopted directly from DIGIT-Frontend's own CI pipeline
logic (a real `push-localization.js` script + workflow that solves the exact
same "get local messages into the backend" problem for CI), not invented for
this tool:**

- **Preferred: `DIGIT_USERNAME` + `DIGIT_PASSWORD` in `.env`.** Logs in via
  `POST /user/oauth/token` (the standard DIGIT password grant, same OAuth
  client id the real pipeline uses) to get a fresh `authToken` + `userInfo`
  every time — never goes stale, no browser dev-tools needed. Deliberately
  **not** accepted as CLI flags — a password on the command line ends up in
  shell history and `ps aux` output; `.env`-only avoids that.
- **Fallback: `--request-info-file <path>`** — a JSON file (see
  `request-info.example.json`) with a real, current `authToken` + `userInfo`
  copied by hand from your browser's session, for anyone who'd rather not
  store credentials at all. Never read from `.env`.
- Authentication only happens **after** you approve — a login is itself a
  real backend interaction, so it doesn't happen just because you previewed
  the payload while intending to decline.

**Other design points, matched to the real pipeline's behavior:**
- Messages are chunked at 300 per `_upsert` call (`CHUNK_SIZE`), so one huge batch can't become one unbounded request.
- Every entry is fully collected and translated *before* anything is shown or sent — a bad translation/module resolution fails visibly up front, not mid-upload.
- Per-call failures are reported individually and don't stop the rest of the batch.

**Verified against a local mock server, never the real DIGIT backend**: decline path sends nothing, approve path sends the exact real request shape (confirmed byte-for-byte against a real captured request), `--dry-run` never even attempts login, wrong credentials fail cleanly with the actual HTTP status + response body, and the `--request-info-file` fallback works unchanged. **Not yet verified: an actual successful login + upsert against a real backend** — that's a deliberate gap (testing it safely would mean writing real data), not an oversight, and is the one thing worth confirming carefully the first time you run this for real.

### `deadcheck` — find keys no longer used anywhere

```bash
digit-i18n deadcheck
```

The inverse of `scan`: for every key already known locally (synced or
pending), checks whether it's still referenced anywhere in code. Anything
not found is reported as a dead-key candidate, grouped by module — **never
deleted automatically**, this is a report for a human to act on.

**Important caveat, and it's a real one:** a key that is *only* ever
referenced through a dynamically-built `t(...)` call (e.g. `` t(`${headerKey}`) ``)
cannot be matched back to its static definition, so it will be wrongly listed
as dead. `deadcheck` reports every dynamic call site it found alongside the
dead-key list specifically so you can cross-check before removing anything.

Options:
- `-p, --path <glob>` — files to scan (default `**/*.{js,jsx}`)
- `-l, --locale <locale>` — locale to check

### `install-hooks` — wire a warn-only pre-commit check into a real repo

```bash
cd <path-to-a-module-inside-a-git-repo>
digit-i18n install-hooks
```

Run this from *inside* a specific module's folder (not the git repo root — it
refuses on purpose, since scoping to the whole repo defeats the point).
Finds the real git root by walking upward, writes (or appends to) a
`.githooks/pre-commit` script there scoped to just that module's path, and
sets `git config core.hooksPath .githooks` for the current clone.

- **Warn-only, always** — the generated hook unconditionally ends with
  `exit 0`, regardless of what any command inside it reports.
- **Multi-module safe** — re-running it from a different module appends a
  new scoped block rather than overwriting the file, so more than one
  module can share the same hook.
- **Local git config only** — `core.hooksPath` isn't shared by cloning or
  pulling. Every other developer needs to run `digit-i18n install-hooks`
  (or the underlying `git config` command) themselves, once.
- **Bakes in absolute paths, doesn't rely on `PATH` at all.** Git hooks run
  in a minimal, non-interactive shell that never sources `.bashrc`/`.profile`
  — neither `node` nor a `yarn link`-installed `digit-i18n` are resolvable
  in that environment by default, even though both work fine interactively.
  Rather than patching `PATH` inside the hook (fragile — depends on guessing
  exactly how each developer's machine is set up), `install-hooks` resolves
  `process.execPath` (the exact node binary currently running the installer)
  and this package's own CLI entry script, and bakes both absolute paths
  directly into the generated hook. Verified to work even under a
  completely stripped environment (`env -i PATH=/usr/bin:/bin`) and via a
  real `git commit`.
- **Upgrade-safe** — re-running the installer for a scope that already
  exists replaces that scope's block with fresh content (new paths, latest
  logic) rather than leaving stale content in place.
- **Runs `lint`, `scan`, and `export`** for any staged file under the scoped
  module (`lint && scan && export`, warn-only). `export` is included because
  it's local-file-only — it just writes/updates
  `localizations/export.<locale>.json`, the same guarantee `lint`/`scan`
  already had. It deliberately runs **without** `--translate-to` in the
  hook — translating on every commit is too expensive/noisy for WIP work.
  Nothing in the hook ever calls `apply`; that stays an explicit,
  separately-invoked step (see [`apply`](#apply--the-only-command-that-ever-writes-to-the-backend)
  and the [CI template](#github-workflowexampleyml--ci-template-for-apply)).

### Automatic setup once this is a real dependency

Right now every developer has to run `digit-i18n install-hooks` manually,
once, after installing the package. Once `digit-i18n-cli` is published and
added as a real dependency (not `yarn link`), this becomes fully automatic:
**`bin/postinstall-hook.js`**, wired up via this package's own `"postinstall"`
script, runs `install-hooks` automatically whenever anyone installs
`digit-i18n-cli` — no script needed in the consuming project's `package.json`
at all, just listing the dependency.

- **Scopes itself by scanning the repo, not by trusting `INIT_CWD`.**
  `INIT_CWD` (the npm/yarn-provided env var recovering the directory the
  developer actually ran `install` from) points at the *wrong* folder in an
  npm/yarn **workspace**, where `install` is normally run once from the
  workspace root rather than from inside whichever package actually depends
  on `digit-i18n-cli`. Instead, the script finds the git root and scans it
  for every `package.json` that actually lists `"digit-i18n-cli"` as a
  dependency (via `src/commands/installHooks.js`'s exported `findGitRoot`),
  and scopes a hook to each one found. `INIT_CWD` is only a fallback, used
  if no declaring `package.json` is found at all (or there's no git root
  above it).
- **Never fails the consumer's install**, no matter what — each scoped
  target is wrapped in its own try/catch, and `process.exitCode` is
  explicitly reset to `0` regardless of outcome. Verified with a real git
  repo (hook set up correctly, including a simulated workspace where
  `INIT_CWD` pointed at the root but the scan still found and scoped the
  actual dependent module), a non-git location, and `INIT_CWD` missing
  entirely — all exit `0`.
- **This is inert under `yarn link`** — linking is just a symlink operation,
  not a real package install, so it doesn't trigger `postinstall` at all.
  This only activates once `digit-i18n-cli` is actually published and
  installed normally.
- **Known limitation**: `--ignore-scripts` environments (common in CI, or
  teams that disable lifecycle scripts) skip this entirely — falls back to
  the manual `install-hooks` step.

### `github-workflow.example.yml` — CI template for `apply`

A GitHub Actions workflow template, following the same `.example.` naming
convention as `.env.example`, `digit-i18n.config.example.json`, and
`request-info.example.json`. It is **not wired into any real repo
automatically** by this project — it's a template you copy by hand:

```bash
cp github-workflow.example.yml <consuming-repo>/.github/workflows/digit-i18n-apply.yml
```

After copying it, edit the two spots it marks for editing: the `branches:`
list under `on.push` (which branches should trigger this — typically
whichever branch a PR merges into, e.g. `master`), and the `MODULE_PATH` env
var together with the matching `paths:` filter (which module folder this
instance applies to). Then configure the 5 secrets it reads from GitHub's
own Settings → Secrets and variables → Actions (never committed to the
repo): `DIGIT_API_BASE_URL`, `DIGIT_TENANT_ID`, `DIGIT_USERNAME`,
`DIGIT_PASSWORD`, `DIGIT_UPSERT_LOCALES`.

Once copied and configured, it runs `npx digit-i18n apply --yes` on every
push to a listed branch (plus supports a manual `workflow_dispatch` re-run
from the Actions tab). This is the intended mechanism for actually closing
the loop the pre-commit hook only detects: reaching one of those branches
already required a human to review and merge a PR, and the committed
`localizations/export.*.json` files in that PR are what a reviewer should
actually be looking at — that review is the human confirmation `apply`
would otherwise ask for interactively, which is why `--yes` is safe here
specifically.

One honest caveat: this step re-derives the payload fresh at merge time (a
new code scan + a fresh machine translation) rather than literally replaying
the committed export file byte-for-byte. Anything a human wrote via `stage`
is committed text, so it's identical to what was reviewed. Machine-translated
entries are re-translated rather than replayed, so the exact wording sent
could differ slightly from what was in the PR diff — the same
`_machineTranslated`/`_needsReview` caveat those entries already carry,
applied once more at merge time. See the file itself for the full inline
rationale.

## Data freshness — nothing auto-syncs by default

**Only `sync` ever talks to the backend.** `search`, `scan`, `export`, and
`deadcheck` work purely off the local `localizations/*.json` files — if
someone else adds keys to the backend after your last `sync`, your local
copy is stale until you explicitly re-sync. Nothing polls, nothing
auto-refreshes, by design (this keeps the tool usable offline and its
network behavior fully predictable).

To make staleness visible instead of silent, those four commands print a
freshness note by default:
```
Local data freshness: oldest is "hcm-common" (last synced 2 hour(s) ago).
Pass --max-age <minutes> to auto-sync when data is older than that, or re-run sync manually.
```

If you want it to actually refresh automatically past a threshold, opt in
with `--max-age <minutes>` on any of those four commands:
```bash
digit-i18n scan --max-age 30 --tenant-id mz
```
This only re-syncs the specific modules that are actually stale (never a
blanket re-sync), and always prints that it's doing so before continuing —
never silently. If the auto-sync itself fails (e.g. no `.env` configured),
the command still falls through and shows results using whatever local data
already exists, but exits with a non-zero status so the failure isn't hidden.

## Supported `t(...)` call patterns

`lint`, `scan`, and `deadcheck` all share one code scanner (`src/scanner.js`)
that recognizes two ways a key can be statically determined:
1. **A plain string literal** — `t("SOME_KEY")`.
2. **A member-expression reference into an imported constants object** —
   `t(I18N_KEYS.PAGES.SOME_KEY)`. Confirmed to be the *dominant* pattern in
   real campaign-manager code (1,595 such calls vs 527 raw literals in one
   check) — this is resolved by parsing the imported file and reading the
   actual assigned string, **not** by assuming the property name matches its
   value (a small but real fraction of entries diverge, including at least
   one real typo — guessing from the name would have produced wrong results
   for those).

Anything else — a template literal with a variable, a runtime object
property (`t(field.label)`), a computed member access, or an import this
tool can't resolve/parse — is genuinely dynamic and reported as a gap by
`lint`/`scan`/`deadcheck`, never silently dropped.

## Design rule (do not violate when extending this)

**Only `sync` reads from the backend automatically, and `apply` is the only
command that ever writes to it — and only when a human explicitly runs it
and confirms.** Every other command (`search`, `stage`, `lint`, `scan`,
`export`, `deadcheck`, `install-hooks`) stays local-only. If you're extending
this tool: do not add a second path to the backend outside `apply`, and do
not make `apply` skip its confirmation by default (`--yes` exists
specifically for CI, where a PR review already served that purpose — see the
[CI template](#github-workflowexampleyml--ci-template-for-apply)).

## Project layout

| Path | Purpose |
|---|---|
| `bin/digit-i18n.js` | Executable entrypoint |
| `bin/postinstall-hook.js` | Auto-runs `install-hooks` on real dependency installs (inert under `yarn link`) |
| `src/cli.js` | Commander wiring / command registration |
| `src/config.js` | `.env`-driven configuration + module registry loader |
| `src/moduleRegistry.js` | `digit-i18n.config.json` prefix → `backendModule` lookups |
| `src/naming.js` | `DIGIT_{MODULE}_{KEY}` formatting, validation, generic-word heuristic |
| `src/scanner.js` | AST scanning (Babel) — shared by `lint`, `scan`, `deadcheck` |
| `src/keyConstantsResolver.js` | Resolves `t(I18N_KEYS.X.Y)` member-expression keys to their real literal value |
| `src/api.js` | Read-only backend client (`_search` only — see design rule above) |
| `src/registry.js` | Local `localizations/*.json` (synced) + `*.pending.json` (staged) read/write helpers |
| `src/dedupe.js` | Whitespace-normalized key comparison + duplicate-group detection |
| `src/syncMeta.js` | Tracks last-synced-at per module/locale (`localizations/.sync-meta.json`) |
| `src/freshness.js` | Staleness report, default warning, opt-in `--max-age` auto-resync |
| `src/missingKeys.js` | Shared missing-key computation — used by `scan` and `export` |
| `src/collectEntries.js` | Shared pending+drafted collection — used by `export` and `apply` |
| `src/translate.js` | Free/unofficial translation helper, used by `export --translate-to` and `apply` |
| `src/digitAuth.js` | OAuth password-grant login for `apply` — adopted from the real DIGIT-Frontend CI script |
| `src/requestInfo.js` | Loads the `--request-info-file` fallback for `apply` |
| `src/confirm.js` | Yes/no terminal prompt, used only by `apply` |
| `src/commands/sync.js` | `sync` implementation — read-only backend pull |
| `src/commands/search.js` | `search` implementation — fuzzy lookup over local data |
| `src/commands/stage.js` | `stage` implementation — writes a local pending entry |
| `src/commands/lint.js` | `lint` implementation — naming/duplicate check |
| `src/commands/scan.js` | `scan` implementation — missing-key report |
| `src/commands/export.js` | `export` implementation — drafts + writes the upload-ready payload file |
| `src/commands/deadcheck.js` | `deadcheck` implementation — dead-key report |
| `src/commands/apply.js` | `apply` implementation — the only command that writes to the backend |
| `src/commands/installHooks.js` | `install-hooks` implementation — generates the scoped pre-commit hook |
| `package.json` | Package metadata, dependencies, and the `postinstall` script that wires up `bin/postinstall-hook.js` |
| `.env.example` | Template for `.env` — backend URL, tenant id, and (for `apply`) login credentials |
| `request-info.example.json` | Template for `apply --request-info-file` |
| `digit-i18n.config.example.json` | Module registry template — copy to `digit-i18n.config.json` and edit |
| `github-workflow.example.yml` | Template to copy into a consuming repo's `.github/workflows/` — runs `apply --yes` on merge |

## Roadmap

- [x] `sync` + `search`
- [x] `stage` + `lint` (warn-only)
- [x] `scan` + `export`
- [x] `deadcheck`
- [x] Real pre-commit hook (`install-hooks`) running `lint && scan && export`
- [x] `apply` — the only backend-writing command, human-confirmed
- [x] Correctly scoped automatic hook setup in npm/yarn workspaces (`bin/postinstall-hook.js`)
- [x] `github-workflow.example.yml` — CI template that runs `apply --yes` on merge
- [ ] Turn `lint`/`scan`'s `--strict` on for real once accuracy is proven on more modules
- [ ] Roll out beyond the initial pilot module
- [ ] Verify a real, successful `apply` run (login + upsert) against an actual DIGIT backend

## License

MIT

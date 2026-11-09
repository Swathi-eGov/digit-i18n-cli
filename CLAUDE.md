# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`digit-i18n-cli` is a local-first CLI (`digit-i18n`) that solves localization-key
hygiene for the DIGIT frontend ecosystem (targets `health/micro-ui-react19/web`
and its module layout). It gives every module a naming convention, a searchable
local registry mirrored from the backend, automatic missing/dead-key detection,
and a safe, human-confirmed path to actually push new keys to the backend.

Published on the public npm registry as `digit-i18n-cli` — install it as a
real dependency, or `yarn link` it locally during development.

**For full technical detail** (every command's internal behavior, every source
file's exports, known limitations) see `docs/TECHNICAL_DOC.md` — verified
accurate against the current source. `README.md` is the user-facing
quick-start/reference, also current. `docs/PLAN.md` is the original proposal
doc, kept for historical context — treat it as background, not a live
reference; for current behavior, `README.md`/`docs/TECHNICAL_DOC.md`/the
actual `src/` win.

## Commands

No build step, no test suite, no project-level lint config exists (the `lint`
command is the product's own feature, not a dev-tool for this repo).

```bash
node bin/digit-i18n.js --help      # run directly
yarn link && digit-i18n --help     # or, linked globally

digit-i18n sync --modules hcm-common,hcm-campaignmanager --locale en_IN
digit-i18n search "save changes"
digit-i18n stage SAVE_BUTTON --module CAMPAIGN --message "Save"
digit-i18n lint
digit-i18n scan
digit-i18n export
digit-i18n apply --dry-run
digit-i18n deadcheck
digit-i18n install-hooks
```

Requires Node >= 20 (pure ESM; `fuse.js@7` is ESM-only). Config comes from
`.env` (copy `.env.example`) and `digit-i18n.config.json` (copy
`digit-i18n.config.example.json`) in the directory the CLI is run from.

To manually exercise a change, run the built CLI against the module tags in
`src/default-modules.config.json` (or a local `digit-i18n.config.json`) with
real `.env` credentials — there is no mock/test harness to fall back on.

## Architecture

### The one rule everything is built around

**Only `sync` ever reads from the backend automatically, and `apply` is the
only command that ever writes to it — and only after a human (or a CI job
after a reviewed PR merge) explicitly confirms.** Every other command
(`search`, `stage`, `lint`, `scan`, `export`, `deadcheck`, `install-hooks`) is
strictly local-only. `src/api.js` enforces this at the lowest level: it
exposes exactly two functions, `searchLocalization` (read, used by `sync`) and
`upsertLocalization` (write, called *only* from `src/commands/apply.js`, and
never with cached/implicit credentials — `apply` always passes a freshly
obtained `requestInfo` in). When extending this tool, never add a second path
to the backend outside these two functions, and never make `apply` skip its
confirmation by default.

### Local registry layout

Each module gets two JSON files per locale under `./localizations/<module>/`:
- `<locale>.json` — pure mirror of the backend, written only by `sync`.
- `<locale>.pending.json` — keys staged locally by `stage`, not yet uploaded.

These are kept strictly separate (`src/registry.js`) so the synced file always
reflects "what's actually live." `loadAllMessages()` is the shared read path
that flattens synced+pending for `search`/`lint`'s duplicate checks, with
synced always winning over pending on key collision. `localizations/.sync-meta.json`
(`src/syncMeta.js`) tracks last-synced-at per module/locale, which
`src/freshness.js` uses to print staleness warnings and (opt-in via
`--max-age <minutes>` on `search`/`scan`/`export`/`deadcheck`) auto-resync just
the stale modules before running.

### Module registry (prefix → backend tag)

`digit-i18n.config.json` (loaded by `src/config.js`, falling back to the
bundled `src/default-modules.config.json`) maps a short local prefix (e.g.
`CAMPAIGN`) to the real backend module tag (e.g. `hcm-campaignmanager`), and
marks exactly one entry `isCommon: true` (the shared module new generic keys
should land in). `src/moduleRegistry.js` is the lookup layer over this.
`stage` uses it to format new keys as `DIGIT_{MODULE}_{KEY}`; `export` uses it
to group drafted payloads by real backend module and reports any key whose
prefix isn't registered, rather than guessing.

### Code scanning — one shared AST scanner, three consumers

`src/scanner.js` (Babel parser + traverse, not regex) finds every `t(...)`
call site across the two patterns real DIGIT code actually uses:
1. A plain string literal: `t("SOME_KEY")`.
2. A member-expression into an imported constants object:
   `t(I18N_KEYS.PAGES.SOME_KEY)` — resolved by `src/keyConstantsResolver.js`,
   which parses the imported file and reads the *actual assigned string*
   rather than assuming the property name matches its value (confirmed real
   divergences exist in campaign-manager, including a typo). This pattern is
   the dominant one in real code (1,595 calls vs. 527 plain literals in one
   module), so skipping it would make the scanner mostly blind.

Anything else (template literals with a variable, computed member access,
runtime object properties) is genuinely dynamic and is reported explicitly as
an unresolvable gap by every consumer — never silently dropped. `lint`,
`scan`, and `deadcheck` all build on this one scanner; `src/missingKeys.js`
and `src/collectEntries.js` are the shared downstream computations (`scan`+
`export` share missing-key logic; `export`+`apply` share pending/drafted entry
collection) so the three "what's missing / what's dead / what to upload"
questions stay consistent with each other.

### The write path: `export` → review → `apply`

`export` only ever **drafts** a local, review-ready `_upsert`-shaped payload
file (`localizations/export.<locale>.json`) — rule-based message drafting
(title-cased from the key name), every drafted entry marked `_needsReview`.
`apply` is the only command that can actually send it: it collects
pending+drafted entries, machine-translates them (`src/translate.js`, an
unofficial/free Google Translate endpoint — no SLA) into every target locale,
prints the exact real request(s) it's about to make, and only authenticates
(`src/digitAuth.js`, the same OAuth password-grant flow as DIGIT-Frontend's
own CI pipeline) and sends *after* explicit confirmation (`src/confirm.js`) or
`--yes` (meant for CI, where a merged, reviewed PR already served as the
confirmation — see `github-workflow.example.yml`). `--dry-run` stops before
any authentication is attempted.

### Pre-commit hook generation (`install-hooks`)

Must be run from inside a specific module folder, not the git repo root — it
walks up to find the real git root, then writes a `.githooks/pre-commit`
block scoped to just that module's path (multiple modules can share one hook;
re-running for an existing scope replaces just that scope's block). The
generated hook bakes in absolute paths (`process.execPath` + this package's
CLI entry script) rather than relying on `PATH`, because git hooks run in a
minimal non-interactive shell that doesn't source `.bashrc`/`.profile`. It
runs `lint && scan && export`, always warn-only (`exit 0` unconditionally) —
`apply` is deliberately never invoked from a hook.

`bin/postinstall-hook.js` automates this via the package's own `postinstall`
script once `digit-i18n-cli` is a real installed dependency (inert under
`yarn link`, since linking doesn't trigger `postinstall`). It scopes itself by
scanning the git repo for every `package.json` that actually lists
`digit-i18n-cli` as a dependency — not by trusting `INIT_CWD`, which points at
the wrong directory in npm/yarn workspaces — and never fails the consumer's
install regardless of outcome.

### Duplicate/whitespace detection

Real backend data has been confirmed to contain keys that are duplicates of
each other except for incidental whitespace. `src/dedupe.js` does
whitespace-normalized comparison and duplicate-group detection; `sync` and
`search` both surface these explicitly rather than letting them silently
produce wrong "missing"/"dead" results elsewhere.

# DIGIT Localization — Problems & Proposed Solutions
*(Originally written for initial team discussion. Updated to reflect what's actually been built — see the "Status" notes throughout, and `README.md`/`SESSION-CONTEXT.md` in this project for full technical detail.)*

**Status: Phases 1–4 are built and tested against real data (the `campaign-manager` module). Phase 5 is partially done: a real, warn-only pre-commit hook (now `lint` + `scan` + `export`) is wired into the actual DIGIT-Frontend repo for campaign-manager, and a real workspace-scoping bug in `bin/postinstall-hook.js` has been found and fixed. Wiring `apply` into DIGIT-Frontend's own Jenkins CI turned out not to be achievable from this codebase at all (see 6.4) — that part is still a "raise it with the platform team" item, not a build task. A separate, generic `github-workflow.example.yml` template now exists for any consuming repo to copy in by hand, closing the loop with an automatic `apply --yes` on merge — see 6.4.**

---

## 1. Problems Today

1. **No naming convention for localization codes.** Every module names keys however it wants (`SAVE`, `HCM_SAVE_CONFIGURATION`, `HCM_AM_SAVE` all exist for "save"). No fixed pattern like `MODULE_KEY`.

2. **No shared place for common keys.** Basic words like SAVE, CANCEL, SEARCH, EDIT, DELETE, NA are re-created independently in almost every module, instead of coming from one common module everyone reuses.

3. **No reuse check before creating a new key.** A developer has no easy way to check "does a key for this already exist?" before adding a new one — so duplicates keep growing.

4. **No single source of truth.** Translations live only in the backend service. There's no per-module, per-language file in the codebase that developers can look at, diff, or review — everything is invisible until the app runs.

5. **Missing translations show the raw key on screen.** If a developer adds a new key in code but forgets to add its translation, the UI just displays the key itself (e.g. `HCM_FOO_BAR`) to the end user — with no warning at build time, commit time, or review time.

6. **Dead keys are never cleaned up.** If a key stops being used in code, nothing detects it — old, unused keys stay in the backend forever.

7. **No standard enforced across teams.** Even where a convention is documented (in release notes), nothing checks that developers actually follow it — it depends entirely on individual discipline.

8. **Translation upload is manual and error-prone.** New keys get pushed to the backend via a manual Excel-based upload process, with no automatic check, no validation, and no audit trail.

**Confirmed against real data since this was written:**
- The real backend contains **36 groups of keys that are duplicates of each other except for incidental whitespace** (e.g. `"CAMPAIGN_ADD_PRODUCT_MANDATORY_ERROR"` vs `" CAMPAIGN_ADD_PRODUCT_MANDATORY_ERROR "`) — a variant of drawback #2/#3 not originally listed.
- The real `campaign-manager` constants file (`i18nKeyConstants.js`) has entries where the key name doesn't match its own translated value (e.g. `HCM_MAP_USERS_BUTTON: "HCM_MAP_USERS"`), including at least one outright typo — confirming drawback #7 (no enforcement) has real, live consequences.

---

## 2. Proposed Solutions

### 1. Enforce a standard naming convention
All localization codes should follow one fixed pattern:
```
DIGIT_{MODULE}_{KEY}
```
Example: `DIGIT_CAMPAIGN_SAVE_BUTTON`, `DIGIT_PGR_SEARCH_HEADER`
This makes it immediately clear which module owns a key just by reading it, and prevents accidental clashes.

*Status: built — `digit-i18n stage` enforces this format automatically; `digit-i18n lint` flags anything already in code that doesn't match it.*

### 2. Create one common module for shared/common keys
Frequently used generic keys (SAVE, CANCEL, SEARCH, EDIT, DELETE, NA, etc.) should live in **one common module** only. All other modules must call and reuse these common keys instead of creating their own versions.

*Status: built — configured per-project in `digit-i18n.config.json` (one entry marked `isCommon: true`); `stage` nudges toward it for generic words, `lint` flags likely duplicates of it.*

### 3. Give every module a local `localizations/` folder (single source of truth)
Each module should have a `localizations/` folder containing one JSON file per language (e.g. `en.json`, `fr.json`).
- These files should be **auto-synced** from the backend via the existing localization search API, so they always reflect what's actually live.
- Because the keys now physically exist in the repo, a developer can **search these files locally** before creating a new key — solving the reuse problem directly.
- This becomes the single source of truth: what's in the repo is what's live, always.

*Status: built — `digit-i18n sync` pulls real data into `localizations/<module>/<locale>.json`; `digit-i18n search` fuzzy-searches it. Also stamps a `.sync-meta.json` with when each module was last synced, and warns (or, opt-in, auto-refreshes) if the local copy looks stale — see "Data freshness" below, added after we discussed what happens if someone else updates the backend after your last sync.*

### 4. Make teams verify against the standard before merging
Every team must check their new keys against:
- The naming convention (#1)
- The common module (#2), to confirm they're not duplicating an existing shared key
This should be a checklist item in code review, backed by tooling (see #5) so it isn't just manual discipline.

*Status: the tooling (`lint`) is built, and the pre-commit half of enforcement is now real and working for campaign-manager (see 6.4). CI enforcement inside DIGIT-Frontend's own Jenkins pipeline is not achievable from this repo at all — its pipeline logic lives in an external shared library. A generic `github-workflow.example.yml` template (GitHub Actions, not Jenkins) exists for any consuming repo that copies it in by hand — see 6.4.*

### 5. Auto-detect new keys at commit time and auto-suggest the upload payload
When a developer commits code:
- A job/script runs and detects any **newly added localization keys** in the diff.
- It collects them into a list, and automatically drafts the messages needed (using the surrounding code/context to draft the message text) and produces the JSON payload needed for the backend `_upsert` call — instead of manually creating this in Excel.
- **The tool only suggests this payload — it does not upload it to the backend itself.** A person reviews the suggested payload and applies it (through the existing admin screen, or a manual upload step), the same way translations are applied today, just without the manual authoring work.
- Goal: **no raw key should ever reach the UI** because every new key already has a ready-to-review translation payload before/at merge time, instead of being discovered later in QA.

*Status: built — `digit-i18n scan` finds the gaps, `digit-i18n export` drafts the payload. Message drafting is deterministic/rule-based (title-cased from the key name), not real AI drafting yet, and every drafted entry is explicitly marked `_needsReview: true`. The output file's shape was corrected to match the real `_upsert` request body exactly (grouped per module, `tenantId`/`module`/`locale` at the batch level) after checking against a real example request.*

### 6. Detect and flag dead/unused keys
A periodic or commit-time check should scan the codebase for keys that are **no longer referenced anywhere**, and flag them for removal — so unused keys don't accumulate forever in the backend.

*Status: built — `digit-i18n deadcheck`. Comes with a confirmed, tested caveat: a key only ever referenced through a dynamically-built `t(...)` call can be wrongly flagged as dead, since its exact string can't be resolved statically — the command lists those call sites alongside the report specifically so a human cross-checks before deleting anything.*

---

## 3. How the Pieces Fit Together

```
Developer writes code
        │
        ▼
Wants a new label →  digit-i18n search "text" (local, synced + pending data)
        │                       │
        │              Found existing key? → Reuse it (done)
        │                       │
        │              Not found? → digit-i18n stage <key> --module <prefix> --message "..."
        │                            (nudges toward the common module if it looks generic)
        ▼
Commit code
        │
        ▼
digit-i18n lint  →  naming-convention + common-duplicate check (warn-only today)
digit-i18n scan  →  finds any key used in code with no translation anywhere
        │
        ▼
digit-i18n export  →  drafts messages, writes a review-ready upload payload
        │                (tool does NOT auto-upload — never calls the backend to write)
        ▼
Person reviews and applies it (existing admin screen / manual step)
        │
        ▼
No raw key ever shown in UI — translation exists before it ships

(Separately: digit-i18n deadcheck flags unused keys for cleanup, on whatever cadence you run it)
```

**Status: this whole flow works today, manually run — and the "commit code" trigger is now real for campaign-manager.** A pre-commit hook fires `lint` + `scan` + `export` automatically for any commit touching that module, warn-only — `export` was added alongside the original `lint`+`scan` pair since it only ever writes a local draft file (`localizations/export.<locale>.json`), same as the other two, so it's covered by the same warn-only guarantee. `apply` is deliberately **not** part of the hook (see 6.4/section 20 in `SESSION-CONTEXT.md`); the actual "publish on merge" trigger now exists as `github-workflow.example.yml`, a template a consuming repo copies in by hand. The "on a schedule, deadcheck" part is still manual/not-built.

---

## 4. Does This Cover the Drawbacks?

Yes — these 6 solutions address the core issues:

| Problem | Solved by |
|---|---|
| No naming convention | #1 |
| Duplicate common keys across modules | #2 |
| No reuse check | #3 |
| No single source of truth | #3 |
| No enforcement across teams | #4 |
| Missing keys shown in UI | #5 |
| No cleanup of unused keys | #6 |
| Whitespace-corrupted duplicate keys *(found after this list was written)* | `sync`/`search` now detect and report these explicitly |

**One thing worth discussing further:** a few localization keys in the current code are built dynamically at runtime (e.g. a key assembled from a data value, not a fixed string in the code). These can't be caught by a commit-time code scan alone, since the exact key doesn't exist in the source — it only appears once the app runs. Confirmed real: ~445 such call sites in `campaign-manager` alone. Every command that scans code reports these explicitly as "needs manual review" rather than pretending to have checked them.

---

## 5. Suggested Next Step

Pick one actively developed module (e.g. Campaign Manager) as a pilot:
1. ~~Set up its `localizations/` folder synced from the backend.~~ **Done** — real data synced (2,563+ keys).
2. Apply the naming convention to new keys only (don't rename old ones yet). **Tooling ready, not yet adopted as team practice.**
3. Try the commit-time new-key detection on this one module first. **Done** — a real pre-commit hook now runs `lint`+`scan` for any commit touching campaign-manager, warn-only.
4. Once proven, roll out to other modules one at a time.

---

## 6. The CLI Tool — `digit-i18n`

All 6 solutions above only work if they're easy to follow in practice. A single CLI tool, installed the same way as any other dev dependency, is what turns these rules into something developers actually use day-to-day instead of a policy nobody checks.

**This has been built.** Project location: `/home/swathi/digit-i18n-cli`. Full technical detail (every design decision, every real bug found and fixed, exact code walkthrough) lives in that project's `README.md` and `SESSION-CONTEXT.md` — this section stays at the "simple explanation" level.

### 6.1 What it is

A command-line tool every developer runs locally. It keeps a local, always-up-to-date copy of translations, and handles searching, creating, validating, and cleaning up localization keys — so the developer never has to touch the backend service or Excel directly.

**One thing it recognizes that wasn't obvious at first:** real code doesn't only write `t("SOME_KEY")` — `campaign-manager`'s dominant pattern is actually `t(I18N_KEYS.PAGES.SOME_KEY)`, referencing a shared constants file (1,595 such calls vs. 527 plain-string calls, confirmed by checking). The tool understands both patterns.

### 6.2 Commands (actual, current syntax)

**Design rule, enforced by the code structure, not just discipline: only `sync` ever reads from the backend automatically, and `apply` is now the only command that ever writes to it — and only when a human explicitly runs it and confirms.** Every other command (`search`, `stage`, `lint`, `scan`, `export`, `deadcheck`) stays local-only.

| Command | What it does |
|---|---|
| `digit-i18n sync --modules <hcm-common,hcm-campaignmanager> --locale en_IN` | Pulls the latest translations from the backend into local `localizations/<module>/<locale>.json` files. Also reports any whitespace-corrupted duplicate keys found in the fresh data, and stamps when each module was last synced. |
| `digit-i18n search "<text>"` | Fuzzy-searches everything known locally (synced + staged) for an existing key/message. Flags results that have a whitespace-duplicate sibling, and whether a match is still only "pending" (staged, not yet live). |
| `digit-i18n stage <KEY> --module <PREFIX> --message "<text>"` | Creates a new key, formatted as `DIGIT_{PREFIX}_{KEY}`, staged **locally only** (never touches the backend). Nudges toward the common module for generic words; warns if something similar already exists. |
| `digit-i18n lint [--path <glob>] [--strict]` | Scans real source code for `t(...)` calls (both plain-string and `I18N_KEYS.X.Y`-style) and flags naming-convention violations and likely common-module duplicates. Warn-only by default. |
| `digit-i18n scan [--path <glob>]` | Finds every key referenced in code with no translation anywhere (synced or pending), with file/line locations. Reports dynamically-built keys it couldn't check, rather than hiding that gap. |
| `digit-i18n export [--tenant-id <id>] [--out <file>]` | Drafts messages for missing keys and writes a review-ready upload payload to `localizations/export.<locale>.json`, grouped per module in the real `_upsert` request shape. **Never uploads anything.** |
| `digit-i18n apply [--to <locales>] [--dry-run] [--yes]` | Collects pending+drafted messages, machine-translates them into every target locale, shows you the real `_upsert` call(s), and — **only after you explicitly confirm** — logs in (or uses `--request-info-file`) and sends them. **The only command in this tool that ever writes to the backend.** |
| `digit-i18n deadcheck [--path <glob>]` | Finds keys that exist locally but are no longer referenced anywhere in code. Report only — never deletes. Flags dynamic call sites as a caveat, since they can cause false positives here. |

**Also built, not in the original plan:** every one of `search`/`scan`/`export`/`deadcheck` accepts `--max-age <minutes>` — by default they just *warn* if local data looks stale, and only auto-refresh (re-running `sync` for the specific stale modules, always announcing it first) if you explicitly opt in with this flag. Added after discussing what should happen if someone updates the backend after your last sync — decided *not* to auto-sync unconditionally, since that would break offline use and make results non-deterministic.

**Two `search` flags worth calling out specifically, since they're easy to miss:**

- **`--limit <n>`** — controls how many fuzzy matches are shown, default **10**. `search` doesn't cap how many things actually match, only how many are printed — a broad query against real data can easily match 30-50+ keys (e.g. everything starting with `APP_CONFIG`/`APP_CONFIGURATION`), and by default you'd only see the top 10, sorted by match score.
  ```bash
  digit-i18n search "APP_CONFIG" --limit 50
  ```
  Shows up to 50 matches instead of the default 10 — useful when a query is a common prefix/substring and you want to see the full spread rather than just the closest few.

- **`--max-age <minutes>`** — the opt-in freshness auto-refresh described above, applied to `search` specifically.
  ```bash
  digit-i18n search "save" --max-age 30
  ```
  Before searching, checks how old the locally synced data is. If it's older than 30 minutes, it automatically re-syncs the stale module(s) first (printing that it's doing so), then searches with the refreshed data. If it's already fresher than 30 minutes, it just searches immediately — no re-sync, no delay. Without `--max-age`, `search` never touches the network at all, it just warns if the data looks old and leaves the decision to re-sync up to you.

### 6.3 How it works, step by step (matches what's actually built)

1. Developer runs `digit-i18n sync --modules ... --tenant-id ...` to get the latest translations locally.
2. Before adding new UI text, developer runs `digit-i18n search "save"` — sees `DIGIT_COMMON_SAVE` already exists, reuses it instead of creating a new one.
3. If it's genuinely new, `digit-i18n stage <KEY> --module <PREFIX> --message "..."` creates it with the correct naming pattern, staged locally.
4. Developer commits code as normal — for `campaign-manager`, this now automatically triggers step 5 via a real pre-commit hook (warn-only, never blocks).
5. Running `digit-i18n lint` + `digit-i18n scan` reports: naming convention violations, likely common-key duplicates, and any key used in code with no translation yet.
6. For any new key with no translation, `digit-i18n export` drafts the message from the key name and outputs the ready-to-review payload — it does not upload anything itself.
7. When ready to actually publish, `digit-i18n apply` re-collects the same entries, machine-translates them into every configured target locale, shows the exact real `_upsert` call(s), and — only after explicit confirmation — logs in (matching the real DIGIT-Frontend CI pipeline's own method) and sends them.
8. `digit-i18n deadcheck`, run on whatever cadence makes sense, reports unused keys so someone can review and remove them.

### 6.4 Rollout Status

- **Phase 1 — DONE:** `sync` + `search`, tested against real backend data.
- **Phase 2 — DONE:** `stage` + `lint` (warn-only).
- **Phase 3 — DONE:** `scan` + `export`.
- **Phase 4 — DONE:** `deadcheck`.
- **Phase 5 — PARTIALLY DONE:**
  - Pre-commit: **done and tested against the real repo**, using `digit-i18n install-hooks` (the CLI's own command, not husky — an earlier attempt used the repo's existing unused `husky` dependency, but that was reverted in favor of the tool's own mechanism, which doesn't depend on a repo already having husky configured).
  - **A real, non-obvious bug was found and fixed along the way**: git hooks run in a minimal shell that never sources `.bashrc`, so neither `node` nor a `yarn link`-installed `digit-i18n` were resolvable inside the hook — even though both work fine in a normal terminal. Instead of patching `PATH` inside the hook (fragile, machine-specific), `install-hooks` now bakes in the exact absolute paths (the node binary and CLI script actually resolved at install time) directly into the generated hook file. Verified this under a completely stripped environment and via a real `git commit` — the earlier PATH-patching approach would have failed both.
  - Scoped to only check commits touching `campaign-manager`. Verified with real (safely reverted) test commits: the hook fires, correctly reports the ~862/881 keys failing the naming convention (expected — none of this code follows it yet), and never blocks the commit.
  - Still warn-only, deliberately — not `--strict`. Turning that on is a separate, later decision once the module's naming compliance is actually improving.
  - **`export` added to the hook — DONE.** The generated hook now runs `lint && scan && export` per scoped module (previously just `lint && scan`). Safe under the same warn-only rule because `export` is local-file-only — it writes/updates `localizations/export.<locale>.json`, never calls the backend. Runs **without** `--translate-to` (too expensive/noisy to translate on every WIP commit); `apply` is still never run automatically by the hook.
  - **A second real bug found and fixed — DONE: `bin/postinstall-hook.js` workspace-scoping fix.** The postinstall script used to trust `INIT_CWD` exclusively to decide which folder to scope a hook to — but in an npm/yarn workspace, `install` is normally run once from the workspace root, not from inside the specific package that depends on `digit-i18n-cli`, so `INIT_CWD` pointed at the wrong folder in that (common) case. Fixed by scanning the git repo for whichever `package.json` file(s) actually declare `digit-i18n-cli` as a dependency and scoping a hook to each one found, falling back to the old `INIT_CWD` behavior only if none are found. `src/commands/installHooks.js` now exports `findGitRoot` so the postinstall script can reuse it instead of duplicating the logic.
  - CI (DIGIT-Frontend's own Jenkins): **found to be unachievable from this codebase.** The real Jenkins pipeline logic lives in an external shared library (`ci-libs`) not present here; `Jenkinsfile`/`build-config.yml` only declare Docker image builds, with no lint/test stage to extend. This needs a conversation with whoever owns that shared library — not something addressable with a code change in this repo.
  - **`github-workflow.example.yml` — DONE, the actual mechanism for closing the loop.** Since Jenkins integration isn't achievable, added a generic GitHub Actions workflow template instead (same `.example.` naming convention as this repo's other templates) that a *consuming* repo copies by hand into `.github/workflows/`, edits two spots (`branches:` list, `MODULE_PATH`/`paths:`), and configures 5 secrets for. Runs `npx digit-i18n apply --yes` on push to a listed branch (typically post-merge) plus manual `workflow_dispatch`. **Not wired into DIGIT-Frontend or any real repo automatically** — it's a template only. See `SESSION-CONTEXT.md` section 21 for the full design rationale.
- **Phase 6 — DONE: `apply`, the one command that writes to the backend.** Built after the user asked directly how the "never show a raw key" goal actually gets guaranteed (answer: it didn't, fully — only detection existed, not enforcement). Rejected auto-triggering this from the commit hook (a login has no natural place in a non-interactive git hook, and approval prompts aren't reliable across all git clients) in favor of a separate, explicitly-run command. **Adopted the real, already-existing DIGIT-Frontend CI solution rather than inventing one** — found a genuine `pushLocalization.yml` + `push-localization.js` on the upstream `ci/localization-push-pipeline` branch (via `git show`, not guessed) that logs in via `POST /user/oauth/token` (DIGIT's standard password grant) instead of requiring a manually-copied browser token. Verified end to end against a local mock server (never the real backend): decline sends nothing, approve sends the exact real request shape, `--dry-run` never even attempts login, wrong credentials fail cleanly, per-call failures don't stop the rest of a batch. **A real security note along the way**: the user pasted a live captured browser session token + personal info into the chat while describing the original ask — flagged immediately as something to rotate, independent of anything built.

### 6.5 How the CLI Resolves Each Drawback

| Drawback | Resolved by |
|---|---|
| No naming convention | `stage` enforces the `DIGIT_{MODULE}_{KEY}` pattern automatically; `lint` flags anything that doesn't follow it |
| Common keys duplicated across modules | `search` surfaces existing common keys first; `stage` nudges generic keys toward the common module |
| No reuse check before creating a key | `search` |
| No single source of truth | `sync` keeps a local JSON copy of the backend always current |
| No enforcement across teams | `lint` now runs automatically on every commit to `campaign-manager` via a real pre-commit hook (warn-only). CI-level enforcement inside DIGIT-Frontend's own Jenkins isn't achievable from this repo (see Phase 5 notes); `github-workflow.example.yml` gives any consuming repo a copy-in GitHub Actions alternative |
| Missing keys shown as raw text in UI | `scan` detects them, `export` prepares a ready-to-review payload (now automatically, via the pre-commit hook), and `apply` can actually publish it — either run by hand, or automatically on merge via `github-workflow.example.yml` (still human-confirmed in effect, since reaching that branch already required a reviewed, merged PR) (see the `--strict`/runtime-safety-net discussion in section 6.4) |
| Dead keys never cleaned up | `deadcheck` |
| Manual, error-prone Excel upload | `apply` replaces it entirely — real `_upsert` calls, in the real request shape, sent directly, no spreadsheet round-trip — while still requiring the same human confirmation Excel-editing used to provide informally |
| Whitespace-corrupted duplicate keys *(found via real data, not in original list)* | `sync`/`search` detect and report these |

**Still worth flagging:** dynamically-built keys (assembled from a runtime value, not a fixed string) can't be resolved by static code scanning, no matter how good the scanner gets. Confirmed real and non-trivial (~445 call sites in one module) — every command that scans code reports these explicitly rather than silently treating them as covered.

---

## 7. How This Was Actually Built

### 7.1 Tech Stack (as built, not just proposed)

| Piece | Choice | Why |
|---|---|---|
| Runtime | Node.js 20, ESM | Matches the target stack (`health/micro-ui-react19/web`); ESM was required once we needed `fuse.js@7` (ESM-only) |
| CLI framework | `commander@12` | Standard subcommand handling |
| Code scanning | `@babel/parser` + `@babel/traverse` | Real AST parsing — finds `t(...)` calls correctly regardless of formatting; regex was ruled out early |
| Fuzzy search | `fuse.js@7` | Off-the-shelf fuzzy matching for `search`/`stage`'s duplicate warnings |
| Local storage | Plain JSON files, no database | Matches "single source of truth lives in the repo" |
| Backend calls (`sync` only) | `axios` | The only file in the whole project that imports it is `src/api.js` |
| Message auto-draft (`export`) | Rule-based (title-cased from the key name) | Deterministic and cheap; every drafted message is marked `_needsReview: true` — real AI drafting was discussed (see below) but not built yet |

### 7.2 What got built, in order

- **Phase 1:** `sync` + `search`, plus the local `localizations/` structure. Tested against the real backend early — this is what first surfaced the whitespace-duplicate-key finding.
- **Phase 2:** `stage` + `lint`, plus `digit-i18n.config.json` (the module-prefix-to-backend-tag registry) and the naming/generic-word rules.
- **Phase 3:** `scan` + `export`. This is where the `export` output shape was corrected after checking against a real example `_upsert` request body, and where the default output location was moved into `localizations/` to keep everything the tool manages in one place.
- **Phase 4:** `deadcheck`, including the confirmed-real dynamic-key false-positive caveat.
- **Phase 5 (partial):** `install-hooks` command, plus a real, tested pre-commit hook wired into `campaign-manager`. Two real bugs caught and fixed along the way: (1) relying on `set +e` alone did not guarantee warn-only behavior — a genuinely failing command inside the hook still blocked a test commit until an explicit, always-last `exit 0` was added; (2) the hook's minimal shell doesn't resolve `node` or a `yarn link`-installed `digit-i18n` the way an interactive shell does — fixed by baking in absolute, already-resolved paths at install time instead of relying on `PATH`. An earlier version of this wired into the repo's existing (previously unused) `husky` setup instead of `install-hooks`'s own mechanism; reverted in favor of consolidating on the tool's own command.
- **Phase 5, continued (this round):** three more real changes.
  1. **`bin/postinstall-hook.js` workspace-scoping bug fixed.** `INIT_CWD` alone pointed at the wrong folder whenever `install` runs from an npm/yarn workspace root rather than the specific dependent package — fixed by scanning the git repo for whichever `package.json` file(s) actually declare `digit-i18n-cli` as a dependency and scoping a hook to each, falling back to `INIT_CWD` only if none are found. `installHooks.js` now exports `findGitRoot` for reuse.
  2. **`export` added to the generated pre-commit hook** (`lint && scan && export`, up from `lint && scan`) — safe under the existing warn-only rule since `export` is local-file-only. Runs without `--translate-to`; `apply` remains deliberately excluded from the hook.
  3. **`github-workflow.example.yml` added** — a copy-in GitHub Actions template that runs `apply --yes` on merge to a configured branch, since wiring into DIGIT-Frontend's real Jenkins CI isn't achievable from this repo. Not wired into any real repo automatically. See `SESSION-CONTEXT.md` section 21.
- **Extra, not originally planned, added after real-data testing surfaced the need:**
  - Whitespace-normalized duplicate detection (`src/dedupe.js`) — real backend data had 36 groups of keys differing only by stray whitespace, which was also causing false "missing"/"dead" results before the fix.
  - Data-freshness tracking (`src/syncMeta.js`, `src/freshness.js`) and the opt-in `--max-age` auto-refresh, after discussing what happens when the backend changes after a `sync`.
  - Member-expression key resolution (`src/keyConstantsResolver.js`) — real code overwhelmingly uses `t(I18N_KEYS.PAGES.SOME_KEY)` rather than plain strings, which the scanner couldn't originally see at all.
  - **Multi-locale sync + auto-translation** — requested directly: support multiple languages at once, and auto-translate an English message into Hindi/French/Portuguese/etc. once it exists. `sync --locale` now accepts a comma-separated list. `export --translate-to hi_IN,fr_FR,pt_MZ` translates every pending/drafted message into each target language and writes a **separate** `export.<locale>.json` per locale. Uses a free, unofficial Google Translate endpoint (no API key) — a real, explicit tradeoff: it's not an officially-supported API (no SLA, can be rate-limited/blocked without notice), chosen deliberately over the paid official API for now. Verified with real translations (confirmed accurate Hindi/French output) and a deliberately invalid locale code to confirm per-entry failures don't break the rest of the run. Every translated entry is tagged `_machineTranslated` and `_translatedFrom`, on top of `_needsReview` — machine translation needs *more* human review than the English draft, not less.
- **Phase 6: `apply`.** The only command that ever writes to the backend, built after directly answering "does anything actually guarantee no raw key reaches the UI?" (no — only detection existed). Rejected wiring this into the automatic pre-commit hook (logins and approval prompts don't belong in a non-interactive git hook) in favor of a separate, deliberately-invoked command. The authentication method — `POST /user/oauth/token`, DIGIT's standard password grant — was **adopted directly from a real, already-existing pipeline found in this repo's own git history** (`ci/localization-push-pipeline` branch, `pushLocalization.yml` + `push-localization.js`, read via `git show`, not guessed), rather than invented. Verified end to end against a local mock server, never the real backend.

### 7.3 Not built yet / not achievable

- **CI wiring into DIGIT-Frontend's own Jenkins — not a build task, a people/process one.** The real Jenkins pipeline logic lives in an external shared library not present in this codebase; there's no lint/test stage in `Jenkinsfile`/`build-config.yml` to extend. Needs a conversation with whoever owns that library. (`github-workflow.example.yml` is the generic GitHub Actions alternative built instead — see 6.4/7.2 above — but it's a copy-in template, not something wired into DIGIT-Frontend itself.)
- **Turning the pre-commit hook `--strict`** — deliberately not done yet; real code isn't compliant enough for that to be useful right now (862/881 keys in campaign-manager fail the naming check).
- **Real distribution.** `digit-i18n-cli` isn't published anywhere shared — every command so far runs via `yarn link` (global, per-machine, manual). A `file:` dependency was considered and rejected: it would only resolve on this one machine, not for other developers cloning the repo. Actually publishing to wherever DIGIT/eGov hosts internal `@egovernments/*` packages is the real fix, and needs registry access/credentials this session doesn't have.
  - **Ready for that moment, already built:** `bin/postinstall-hook.js` — once this package is a real dependency, hook setup becomes fully automatic (no `prepare` script needed in the *consuming* project at all — this lives in our own package's `postinstall`). Tested in isolation (success + two graceful-failure cases), but genuinely inert until real publishing happens, since `yarn link` doesn't trigger `postinstall`. The workspace-scoping bug that would otherwise have hit real multi-module rollouts (see Phase 5, continued, above) is now fixed ahead of that moment, not left for later.
- Real AI-assisted message drafting for `export` (currently rule-based only).
- The MCP-server wrapper and Figma/Playwright integration ideas discussed for richer, AI-assisted correlation between design, code, and translations — designed conceptually, intentionally not built since it wasn't necessary yet (this session already has direct shell access to the CLI, which is most of what an MCP wrapper would provide).

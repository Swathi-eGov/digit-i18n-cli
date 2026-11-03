# Claude Code slash commands for `digit-i18n`

This folder is a **copy-in template** — same pattern as `.env.example` or
`digit-i18n.config.example.json` elsewhere in this repo. It isn't used by
anything in this project automatically; it's meant to be copied into a
*consuming* project (e.g. a specific module inside DIGIT-Frontend) so
developers working there can trigger `digit-i18n` from inside a Claude Code
chat with `/i18n-...` instead of (or alongside) typing the CLI directly.

## Setup

Claude Code looks for slash commands in a project's own `.claude/commands/`
folder (plus your personal `~/.claude/commands/`, which applies to every
project on your machine but isn't shared with your team). To make these
available while working on a specific module:

```bash
mkdir -p <path-to-your-module>/.claude/commands
cp /path/to/digit-i18n-cli/commands/*.md <path-to-your-module>/.claude/commands/
```

For example, inside DIGIT-Frontend:

```bash
cp /path/to/digit-i18n-cli/commands/*.md \
  health/micro-ui-react19/web/packages/modules/campaign-manager/.claude/commands/
```

Commit that `.claude/commands/` folder to the consuming repo if you want
every teammate who opens Claude Code there to get these commands too (do
**not** commit a personal copy under `~/.claude/commands/` — that path is
local to your machine only).

## Prerequisite — these are thin wrappers, not a replacement

Every command here just runs the real `digit-i18n` CLI via a shell command —
nothing here does any setup of its own. `digit-i18n` itself must already be
installed and working wherever you run these (see this repo's own
`README.md` → Setup: `yarn install` + `yarn link`, a filled-in `.env`, and a
`digit-i18n.config.json`). The CLI also reads its config relative to the
current working directory, so these commands are meant to be used from
inside the specific module folder you're working on — not a workspace root.

The underlying CLI (terminal usage) keeps working completely unchanged;
these slash commands are purely an additive convenience layer for anyone
already using Claude Code in that repo.

## When something fails

Every command here checks `command -v digit-i18n` first and, if it's
missing, stops and tells you plainly to finish the setup above rather than
failing with a raw "command not found." Each command also knows the real
CLI's own error messages for its specific failure modes (e.g. `sync`'s
`"DIGIT_API_BASE_URL is not set"`, `stage`'s `"Unknown module prefix"`,
`apply`'s `"Missing tenantId"`, `install-hooks`'s "not a git repo"/"refusing
to scope to the git root") and explains those in plain language with the
concrete fix, instead of just pasting the raw error text.

## What's here

| Command | Wraps | Writes to the backend? |
|---|---|---|
| `/i18n-sync` | `digit-i18n sync` | Yes — the only read |
| `/i18n-search` | `digit-i18n search` | No |
| `/i18n-stage` | `digit-i18n stage` | No — local only |
| `/i18n-lint` | `digit-i18n lint` | No |
| `/i18n-scan` | `digit-i18n scan` | No |
| `/i18n-export` | `digit-i18n export` | No — local file only |
| `/i18n-deadcheck` | `digit-i18n deadcheck` | No — report only |
| `/i18n-apply` | `digit-i18n apply --dry-run` (always forced) | **Never, from chat** — see below |
| `/i18n-install-hooks` | `digit-i18n install-hooks` | No — local git config only |

### `/i18n-apply` is deliberately restricted

The real `digit-i18n apply` is the only command in this whole tool that ever
writes to the backend, and it normally requires an interactive `yes`/`no`
confirmation (and often a fresh login) typed directly into a real terminal.
That can't work reliably through a chat session, so `/i18n-apply` always
forces `--dry-run` — it will show you exactly what *would* be sent, but will
never actually send it. When you're ready to publish for real, run
`digit-i18n apply` yourself, directly in your own terminal.

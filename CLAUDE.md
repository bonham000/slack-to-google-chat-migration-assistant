# CLAUDE.md

## Build & Test

```bash
bun install              # install dependencies
bunx tsc --noEmit        # type-check (run after any code changes)
bun test                 # run all unit tests (83 tests across 9 files)
bun run dev              # start the interactive CLI
```

Always run `bunx tsc --noEmit` and `bun test` after making code changes to catch type errors and regressions.

## Architecture

- **Runtime**: Bun + TypeScript (ES modules)
- **CLI**: `@clack/prompts` for interactive prompts, spinners, and formatted output
- **State**: `bun:sqlite` (synchronous, WAL mode) for idempotent migration tracking
- **Google APIs**: `googleapis` + `google-auth-library` with domain-wide delegation for user impersonation

## Key Design Decisions

- **Idempotency**: Every migrated message is keyed by `(slack_ts, slack_channel)` in SQLite. Re-runs skip already-migrated messages automatically.
- **User impersonation**: Happens at the auth client level (JWT `subject` field), not in the message payload. Auth clients are cached per email.
- **Unmapped users/bots**: Messages attributed with `[Display Name]: message text` prefix using the admin's auth client.
- **Threading**: Slack `thread_ts` maps directly to Google Chat `threadKey`. Only set on messages that are actually part of threads.
- **Bun SQLite compatibility**: Use `!= null` (loose equality) when checking query results — Bun's `sqlite.get()` may return `undefined` instead of `null` for no rows.

## Conventions

- No raw `info()` logging during migration — use `MigratorCallbacks` lifecycle hooks so the CLI controls all user-facing output via `@clack/prompts` spinners.
- Error handling: per-message failures are logged and skipped (retried on next run). Per-channel failures continue to next channel.
- Tests live in `tests/unit/` with fixtures in `tests/fixtures/minimal-export/`.

# Slack to Google Chat Migration Assistant

Interactive CLI tool that migrates Slack message history into Google Chat using the [Import Mode API](https://developers.google.com/workspace/chat/import-data-overview).

## Features

- Parses Slack export ZIP files (or extracted directories)
- Maps Slack users to Google Workspace accounts by email
- Preserves message threading
- Idempotent — safely re-run to resume or widen the time scope (7 days → 30 days → full)
- Dry-run mode for previewing without Google API credentials
- SQLite state tracking for crash recovery
- Compiles to standalone executables for macOS and Windows

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- A Slack export ZIP file (Settings > Import/Export Data)
- For live migration: a Google Cloud service account with domain-wide delegation (see [USAGE_GUIDE.md](USAGE_GUIDE.md))

## Quick Start

```bash
bun install
bun run dev
```

The interactive CLI will walk you through the rest.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the interactive CLI |
| `bun test` | Run unit tests |
| `bun test --watch` | Run tests in watch mode |
| `bun run build:macos-arm` | Build macOS ARM executable |
| `bun run build:macos-x64` | Build macOS x64 executable |
| `bun run build:windows` | Build Windows executable |

## Project Structure

```
src/
├── index.ts                  # Entry point
├── types.ts                  # Shared TypeScript interfaces
├── constants.ts              # API limits, scopes, skip-lists
├── errors.ts                 # Error hierarchy
├── cli/                      # Interactive prompts and display
├── core/                     # Migration engine (migrator, channel processor, config)
├── db/                       # SQLite schema, queries, state management
├── services/
│   ├── google/               # Chat API, Directory API, auth, rate limiter
│   ├── slack/                # Export parser, message reader, user mapper
│   ├── formatting.ts         # Slack mrkdwn → Google Chat text
│   └── dry-run.ts            # No-op API for dry-run mode
└── utils/                    # Timestamps, retry, logging
```

## How It Works

1. Parse the Slack export to discover channels, users, and messages
2. Map Slack users to Google Workspace accounts by email
3. For each channel, create a Google Chat space in import mode
4. Send messages with original timestamps, preserving threads
5. When satisfied, finalize spaces to make them visible to users

See [USAGE_GUIDE.md](USAGE_GUIDE.md) for full setup instructions.

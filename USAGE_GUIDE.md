# Slack → Google Chat Migration: Setup & Usage Guide

This guide walks you through the complete setup required to migrate your Slack message history to Google Chat.

## Prerequisites

- **Slack**: Workspace admin/owner access (to export data)
- **Google Workspace**: Super admin access (to configure service account delegation)
- **Runtime**: [Bun](https://bun.sh) installed — or use the standalone executable (no install needed)

---

## Step 1: Export Your Slack Data

1. Go to **Slack Admin** → [https://my.slack.com/services/export](https://my.slack.com/services/export)
2. Choose your date range (or "Entire history")
3. Click **Start Export**
4. Wait for the email notification, then download the `.zip` file
5. Place the ZIP file in the same directory as the migration tool

> **Note**: Free Slack plans can only export public channels and the last 90 days.
> Business+ and Enterprise plans can export private channels and DMs via Corporate Export.

---

## Step 2: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Name it (e.g., `slack-chat-migration`) and click **Create**
4. Select the new project

### Enable Required APIs

In the new project, go to **APIs & Services** → **Library** and enable:

- **Google Chat API** — search for "Google Chat API" and click **Enable**
- **Admin SDK API** — search for "Admin SDK API" and click **Enable**

---

## Step 3: Create a Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Name: `slack-migration` (or any name)
4. Click **Create and Continue**
5. Skip the optional roles, click **Done**
6. Click on the new service account → **Keys** tab
7. Click **Add Key** → **Create new key** → **JSON** → **Create**
8. Save the downloaded JSON file as `service-account-key.json` in the migration tool directory

---

## Step 4: Configure Domain-Wide Delegation

This allows the service account to impersonate users in your Google Workspace (so migrated messages appear from the correct sender).

### 4a: Enable delegation on the service account

1. In Google Cloud Console → **IAM & Admin** → **Service Accounts**
2. Click on your service account
3. Under **Details**, find **Domain-wide delegation** and click **Show Advanced Settings**
4. Check **Enable Google Workspace Domain-wide Delegation**
5. Save. Note the **Client ID** (a long number)

### 4b: Authorize scopes in Google Workspace Admin

1. Go to [Google Workspace Admin Console](https://admin.google.com/)
2. Navigate to **Security** → **Access and data control** → **API controls**
3. Click **Manage Domain Wide Delegation**
4. Click **Add new**
5. Enter the **Client ID** from step 4a
6. Enter these OAuth scopes (comma-separated, no spaces):

```
https://www.googleapis.com/auth/chat.import,https://www.googleapis.com/auth/admin.directory.user.readonly
```

7. Click **Authorize**

---

## Step 5: Run the Migration Tool

### Option A: Using Bun (development)

```bash
# Install dependencies
bun install

# Run the tool
bun run dev
```

### Option B: Using the standalone executable

```bash
# macOS
./migrate

# Windows
migrate.exe
```

### The Interactive Flow

When you run the tool, it will guide you through:

1. **Select your Slack export** — auto-detects `.zip` files in the current directory
2. **Choose an action** — New migration, Resume, Status, or Finalize
3. **Enter credentials** — path to service account key + admin email
4. **Select time scope** — Last 7 days, 30 days, full history, or custom
5. **Choose run mode** — Dry run (preview) or Live migration

### Recommended Migration Sequence

```
1. bun run dev    →  Choose "New migration" → "Last 7 days" → "Dry run"
   (Preview what will happen — no changes made)

2. bun run dev    →  Choose "New migration" → "Last 7 days" → Live
   (Migrate 7 days of messages)

3. bun run dev    →  Choose "Resume" → "Last 30 days" → Live
   (Only migrates days 8-30, skips already-migrated messages)

4. bun run dev    →  Choose "Resume" → "Full history" → Live
   (Migrates all remaining messages)

5. bun run dev    →  Choose "Finalize"
   (Makes all spaces visible to users in Google Chat)
```

---

## Step 6: Verify in Google Chat

After finalization:

1. Open [Google Chat](https://chat.google.com/)
2. Your migrated channels should appear as Spaces with the prefix "Slack #"
3. Check that messages appear with correct authors and timestamps
4. Verify threads are grouped correctly

---

## Troubleshooting

### "403 Forbidden" errors

- Verify domain-wide delegation is configured correctly (Step 4)
- Ensure both OAuth scopes are authorized
- Confirm the admin email you provided is a Super Admin

### "401 Unauthorized" errors

- Check that the service account key JSON file is valid and not expired
- Verify the Google Chat API is enabled in your GCP project

### "429 Rate Limit" errors

- The tool automatically retries with backoff
- For very large migrations, the tool respects the 600 messages/minute import mode limit

### Messages from external users show as "[Name]:"

- This is expected — Google Chat can only impersonate users within your Workspace domain
- External guests, Slack Connect users, and bots get a name prefix instead

### "Import mode space will expire"

- Import mode spaces auto-delete after 90 days if not finalized
- Run the "Finalize" step before this deadline

---

## Building Executables

To create standalone executables (no Bun installation required on the target machine):

```bash
# macOS (Apple Silicon)
bun run build:macos-arm

# macOS (Intel)
bun run build:macos-x64

# Windows
bun run build:windows
```

Output binaries are placed in the `dist/` directory.

---

## Data & Privacy

- **No data leaves your machine** except messages sent to the Google Chat API
- The migration state database (`migration-state.db`) is stored locally
- Service account credentials are never logged or transmitted
- The Slack export ZIP is only read locally, never uploaded anywhere

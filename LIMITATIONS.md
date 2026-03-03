# Limitations

Known limitations of the Slack to Google Chat migration, why they exist, and how we work around them.

## Google Chat Import API Restrictions

### 1:1 Direct Messages Cannot Be Imported as DMs

The Google Chat Import Mode API does not support creating spaces with `SpaceType: DIRECT_MESSAGE`. This is a hard limitation of the API — there is no workaround that produces a true DM in Google Chat.

**Mitigation**: 1:1 DMs are imported as a private `GROUP_CHAT` with the two original participants as members. The message history is fully preserved and only those two users can access the space. The trade-off is that these conversations appear in the user's "Spaces" section rather than "Direct messages" in Google Chat.

### Group DMs

Slack group DMs (multi-party direct messages) do not have a direct equivalent in Google Chat's DM model.

**Mitigation**: Group DMs are imported as a `GROUP_CHAT` with all original participants as members. This is actually a natural fit — Google Chat's group conversations are functionally the same as Slack's group DMs. These appear in the "Spaces" section in Google Chat.

### Private Channels

Private Slack channels are fully supported. They are imported as a `SPACE` with `accessSettings.accessState: PRIVATE`, meaning only explicitly added members can discover or access the space.

### External Users (Guests)

Slack guests or users outside your Google Workspace domain cannot be added as members during import mode. External users can only be added after a space is finalized.

**Mitigation**: Messages from external users are still imported using the `[Display Name]: message` fallback attribution (sent via the admin account). External users can be manually invited to the space after finalization if needed.

### 90-Day Import Window

Spaces created in import mode must be finalized within 90 days. If not finalized in time, the space is **automatically and permanently deleted** by Google.

**Mitigation**: The tool tracks all unfinalized spaces in its SQLite database. Run the tool and choose "View migration status" to see which spaces still need finalizing. Plan your migration timeline accordingly — complete all import runs and finalize well before the 90-day deadline.

### Membership Is Two-Phase

The Import API separates membership into two phases:

- **During import mode**: Only historical memberships (users who have already left) can be created, and they require a `deleteTime` field.
- **After finalization**: Active memberships (users who should see and use the space) must be created after calling `completeImport`.

This means users will not see migrated spaces until after finalization and membership assignment.

## Slack Export Restrictions

### Export Tier Determines What's Available

| Slack Plan | Public Channels | Private Channels | DMs |
|---|---|---|---|
| Free / Pro | Yes | No | No |
| Business+ | Yes | Yes (compliance export) | Yes (compliance export) |
| Enterprise Grid | Yes | Yes (compliance export) | Yes (compliance export) |

Private channels and DMs require a Slack Business+ plan or higher and must be exported via a compliance export (requested through Slack admin settings with an approval process).

### Standard Export Limitations

A standard Slack export (available on all plans) only includes public channels. If you need private channels or DMs, you must use the compliance/corporate export process which requires admin approval and may take time to generate.

## Message Fidelity

### Attachments Are Not Migrated

File attachments (images, PDFs, documents, etc.) are not transferred to Google Chat. The Slack export includes file metadata but not always the actual file content, and the Google Chat Import API does not support file uploads during import mode.

**Mitigation**: Attachment references are preserved as placeholder text in the migrated message, e.g. `[Attachment: report.pdf]`. The original files remain accessible in Slack for the duration of your Slack retention policy.

### Reactions Are Not Migrated

Emoji reactions on messages are not included in the current migration. The Import API does support reaction import, but this is not yet implemented.

### Rich Formatting Is Simplified

Slack's `mrkdwn` formatting is converted to Google Chat's text format on a best-effort basis:

- User mentions (`<@U1234>`) are resolved to display names or email addresses
- Channel references (`<#C1234|general>`) are converted to `#general`
- Links (`<url|text>`) are preserved
- Special mentions (`<!here>`, `<!channel>`) become `@here` / `@channel`
- Bold, italic, strikethrough, and code blocks are preserved where Google Chat supports them
- Complex Slack Block Kit messages (from apps/integrations) may lose structured layout

### Bot and Integration Messages

Messages from Slack bots and integrations are imported with a `[Bot Name]: message` prefix, sent via the admin's Google Workspace account. The original bot identity is not preserved as a distinct sender in Google Chat.

## User Mapping

### Email-Based Matching Only

Users are mapped between Slack and Google Chat by matching email addresses. If a Slack user's email does not correspond to a Google Workspace account:

- Their messages are imported with a `[Display Name]: message` prefix
- They are sent via the admin's account
- The original user does not appear as the message sender in Google Chat

### Deactivated Google Workspace Accounts

If a user's Google Workspace account has been deactivated or deleted, the tool cannot impersonate that user. Their messages fall back to the `[Display Name]:` attribution method.

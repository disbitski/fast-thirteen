# Guest Migration Dry Run

Fast Thirteen stays local-first while authentication is being added. Before any
signed-in account can receive local guest history, the app builds a dry-run
migration plan that reports exactly what would sync.

## What The Planner Does

The planner in `src/migrationPlan.js` is a pure data layer. It does not call
Supabase and it does not mutate browser or file-backed local data.

Given local data, an authenticated user, and any known cloud sessions, it:

- Creates a normalized JSON backup of the local data first.
- Validates raw local sessions before considering them for upload.
- Requires a signed-in user id before migration can be allowed.
- Skips active fasts until they are completed.
- Compares local and cloud sessions by stable session id.
- Avoids duplicate uploads when the cloud already has the same latest record.
- Plans uploads or updates only when the local record is newer.
- Preserves tombstoned deletions so deleted fasts can later sync safely.
- Reports invalid local sessions as blockers instead of silently syncing around
  them.

## Deterministic Merge Rules

Session identity is the stable `id` field. When local and cloud both contain the
same id, the newer `updatedAt` wins. If `updatedAt` ties, a local `deletedAt`
tombstone wins over a non-deleted cloud record so confirmed deletions do not
come back during migration.

Upload candidates are sorted by `updatedAt` and then by `id`. That keeps the
preview deterministic for tests, logs, and future UI review.

## Current Safety Boundary

The dry run can return upload candidates, but it is not a sync operation. A
future milestone still needs to:

- Show the preview to the signed-in user.
- Write the planned sessions to Supabase with row-level security enabled.
- Read the records back from Supabase to confirm the cloud copy.
- Mark local sync status only after confirmation succeeds.

Until then, local-only tracking, LAN access, exports, restores, and the
analytics dashboard keep using the existing versioned local data.

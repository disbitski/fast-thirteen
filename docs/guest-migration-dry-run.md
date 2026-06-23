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

The app now includes a small migration preview surface in the profile/settings
area. It shows backup readiness, planned upload/update/delete counts, skipped
active sessions, duplicate skips, and invalid-session blockers from the dry-run
planner.

The app also has a migration executor interface in `src/migrationExecutor.js`.
It is still not connected to Supabase. The executor requires a current
authenticated user, a precomputed migration plan, and a repository object. It
validates blockers, requires the local backup to exist, preserves that backup
first, and then dispatches upload/update/tombstone calls to the supplied
repository before calling a final confirmation hook. Tests use a mocked
repository so execution behavior is covered without making cloud writes.

`src/supabaseMigrationRepository.js` now defines the Supabase repository shape
for the next step. It maps local sessions to `fast_sessions` rows, exposes the
required `preserveBackup`, `uploadSession`, `updateSession`, `tombstoneSession`,
and `confirmMigration` methods, and reports readiness separately from
execution. Publishable Supabase config alone is not enough to write. Migration
writes stay disabled unless `SUPABASE_MIGRATION_WRITES_ENABLED=true` is present
and the repository is created with explicit execution support.

The dry run can return upload candidates, but it is not a sync operation. A
future milestone still needs to:

- Wire the Supabase repository into a reviewed write path with row-level
  security enabled.
- Read the records back from Supabase to confirm the cloud copy.
- Mark local sync status only after confirmation succeeds.

Until then, local-only tracking, LAN access, exports, restores, and the
analytics dashboard keep using the existing versioned local data.

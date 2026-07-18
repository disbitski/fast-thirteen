# Cross-Device Sync Readiness Runbook

Fast Thirteen is still local-first. The cross-device sync code now has
planning, preview, execution scaffolds, confirmation checks, and local
finalization gates, but live Supabase writes remain intentionally disabled
until the whole path can be reviewed end to end.

This runbook captures the current implementation boundary and the checks to
run before enabling real cloud mutation.

## Current Safety Boundary

Local tracking must keep working whether auth and sync are configured or not.
The app can start, end, edit, delete, export, restore, and analyze fasts from
the versioned local data store without a signed-in profile.

The current cloud-sync path is local-safe:

- Cloud reads are modeled by `src/syncReadPlan.js` and executed through
  `src/syncPull.js` only when read readiness is explicit.
- Applying a read plan is gated by `src/syncApply.js` and preserves a local
  backup before changing local data.
- Cloud pushes are planned by `src/syncPushPlan.js` and can preview upload,
  update, tombstone, duplicate, invalid, and skipped-session decisions.
- Push execution in `src/syncPushExecutor.js` requires explicit write readiness
  and a repository adapter. Tests use mocked repositories.
- Supabase row mapping and disabled repository shapes live in
  `src/supabaseMigrationRepository.js`.
- Push confirmation and local sync-status finalization are separated in
  `src/syncPushFinalizer.js`.
- `src/syncOrchestration.js` summarizes read, apply, push, repository, and
  finalization gates for the profile/settings UI.

No module should mark local sync state as synced until read-back confirmation
and local finalization both succeed.

## Implemented Versus Gated

Implemented:

- Guest mode and Local data labels.
- Versioned local data, backups, imports, and shared-Mac server storage.
- Stable session ids with `updatedAt` and `deletedAt` tombstones.
- Read planning from Supabase-shaped `fast_sessions` rows.
- Local apply scaffolding that preserves a backup first.
- Push planning for upload, update, tombstone, duplicate, local-newer, and
  remote-newer cases.
- Push execution scaffolding against mocked repositories.
- Supabase repository adapter shapes and row mapping.
- Read-back confirmation result mapping.
- Local sync metadata finalization scaffold.
- Orchestration/status models and profile/settings preview UI.
- Scenario coverage for concurrent edits, offline recovery, duplicate
  avoidance, tombstone precedence, and local-newer versus remote-newer
  decisions.
- Browser-safe, exact-version Supabase SDK bootstrap that runs only when
  publishable config exists and falls back to local tracking on load failure.
- Local-safe Google OAuth launch control with readiness gating, in-flight
  deduplication, durable callback feedback, and token-free app state.
- One deterministic OAuth/read validation report that summarizes readiness,
  the test profile's RLS/read result, invalid rows, merge preview, and disabled
  apply/write gates without exposing raw cloud rows.

Still gated:

- Real Google OAuth provider credentials.
- Apple login.
- Live Supabase cloud reads in production.
- Live Supabase upload/update/tombstone writes.
- Local apply of cloud reads from a production account.
- Local sync-status finalization after production push confirmation.
- Account deletion and server-side data export paths.

Publishable Supabase config alone is not enough to write. Write, confirmation,
and finalization support must be enabled deliberately and tested with a
throwaway account before real user data is synced.

## Deterministic Conflict Rules

Session identity is the stable `id` field.

1. Newer validated `updatedAt` wins.
2. If timestamps tie, a tombstone wins over a non-deleted session.
3. Active local sessions are skipped until completed.
4. Invalid local or remote sessions become blockers.
5. Duplicate rows are ignored deterministically instead of causing extra
   uploads.
6. Failed cloud reads and blocked push confirmations must not mutate local
   tracking data.

These rules are covered across `test/sync-read-plan.test.js`,
`test/sync-apply.test.js`, `test/sync-push-plan.test.js`,
`test/sync-push-executor.test.js`, `test/sync-push-finalizer.test.js`,
`test/sync-orchestration.test.js`, and `test/sync-scenarios.test.js`.

## Manual Checks

Run the test suite before changing sync gates:

```sh
npm test
```

Confirm the local server still exposes shared local data:

```sh
npm start
curl -s http://127.0.0.1:4173/api/data
```

Confirm the LAN URL still works from another device while the server is
running:

```sh
http://192.168.86.50:4173/
```

Confirm GitHub Pages uses sample data and does not expose the Mac's local data:

```sh
https://disbitski.github.io/fast-thirteen/
```

Check the tracker, analytics dashboard, and all themes after frontend changes.
For documentation-only changes, no browser verification is required.

## Read-Only Supabase Validation

Use this flow before any upload, update, tombstone, confirmation, or
finalization gate is enabled. The goal is only to prove that a signed-in test
profile can read its own `fast_sessions` rows through RLS while local tracking
continues to work if anything fails.

Prerequisites:

- Use a throwaway Google/Supabase test account.
- Apply the `profiles` and `fast_sessions` schema with RLS enabled.
- Keep service-role keys, OAuth secrets, Apple signing keys, and generated
  client secrets outside Git.
- Configure only browser-publishable values locally:

```sh
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-anon-key>
SUPABASE_GOOGLE_PROVIDER_ENABLED=true
SUPABASE_AUTH_REDIRECT_ORIGINS=http://127.0.0.1:4173
```

The browser bootstrap loads the exact SDK version declared in
`src/supabaseSdkBootstrap.js`. Before using a throwaway profile, confirm the UI
moves from `Loading SDK` to an auth-ready state. A `Client issue` state means
the CDN, network, or client initialization failed; stop cloud validation there
and continue using Local data.

Before setting the public provider flag to `true`, configure Google in the
Supabase dashboard and add the exact local application return URL to Supabase
Auth Redirect URLs. Confirm the UI reports `Ready`, `Enabled`, `Allowed`,
`Clear`, and `Ready` across its five Google sign-in stages. This only enables
the OAuth attempt; every cloud mutation gate remains off.

Validation steps:

1. Start the local server with publishable Supabase and explicit OAuth readiness
   config only.
2. Sign in with the throwaway Google profile.
3. Confirm the app still shows existing Local data and can export a backup.
4. Insert or inspect test-only `fast_sessions` rows for that same Supabase user.
5. Run the read-only repository path. It must query only
   `fast_sessions.select("*").eq("user_id", auth.uid()).order("updated_at")`.
6. Build a `createCloudReadPlan` preview from the returned rows.
7. Do not apply the plan unless local apply support has been explicitly enabled
   for the test.
8. Confirm bad rows are reported as blockers and do not change local history.
9. Confirm read failures keep local sessions and sync metadata unchanged.

The pull result includes a deterministic `diagnostics` model for checking each
handoff without guessing from UI copy:

1. `readiness` confirms publishable config, the browser client, and the signed-in
   test profile are ready.
2. `repositoryRead` confirms the `fast_sessions` query ran, or explains why it
   was not attempted or failed.
3. `mergePlan` confirms returned rows were validated and merged into a preview
   by stable session id. Invalid rows block here.
4. `localApply` remains `gated` until apply support is explicitly enabled. When
   enabled, diagnostics require a backup before the offline copy can change.

A successful read with local apply disabled reports `preview`. Explicit apply
support changes that to `apply-ready`, but still does not mutate data by itself.
Repository failures or invalid rows report `blocked`; missing readiness reports
`disabled`. In every state, `dataMutated` and `localSyncStatusChanged` remain
false until `applyCloudReadPlan` is deliberately called and succeeds.

The profile/settings refresh control uses the same read controller as automatic
preview loading. It is unavailable until read readiness passes, shows a loading
state while the read-only query runs, and changes to a retry action after a
blocker. Automatic reads are deduplicated, while an explicit retry starts a new
request. If local data or the signed-in profile changes during a request, the
older response is ignored and cannot replace the newer preview. Refresh never
calls local apply or any Supabase mutation method.

The adjacent OAuth/read validation report is a summary, not another execution
path. It composes the existing OAuth readiness, token-free session health, and
pull diagnostics into nine stages and exposes only counts. `ready` means the
throwaway profile passed OAuth, the read-only `fast_sessions` query, and merge
planning. `blocked` surfaces the
read/RLS or invalid-row reason. Both states keep local apply and every cloud
write gate disabled, keep sync metadata unchanged, and omit provider tokens.

Authenticated preview state is isolated by `src/authProfileCoordinator.js`.
Each authenticated lifecycle receives a generation-scoped identity key. A
user change, sign-out, expired session, or auth refresh failure invalidates the
pull controller immediately and clears its rows and counts. Signing the same
user out and back in also creates a new generation, so a late response from the
older lifecycle cannot become current. The validation report accepts pull
diagnostics only when the request identity matches the current profile scope.

The session-health card is driven by `src/authSessionHealth.js`. It normalizes
Supabase auth lifecycle events, displays the last local `getSession()` check,
its initial/manual/resume/reconnect source, and whether profile preview state is
scoped, protected, inactive, or reset. The manual Check session action is
deduplicated and stale-response safe. `src/authSessionRecovery.js` reuses that
controller when a configured browser becomes visible or returns online. Hidden,
offline, disabled, duplicate, and cooldown-window signals are ignored. Both
paths can only re-read auth state; they cannot launch OAuth, read
`fast_sessions`, apply a merge plan, update sync metadata, or call any Supabase
mutation method.

### Session Health Recovery Checks

1. Load without Supabase config and confirm `Local fallback`, Guest mode, Local
   data, and a disabled Check session action.
2. With publishable config and the SDK ready, run Check session while signed
   out. Confirm a last-check time appears and fasting history is unchanged.
3. Sign in with throwaway profile A. Confirm `Session healthy` and a
   profile-scoped preview message without a user id or token in the UI.
4. Trigger `TOKEN_REFRESHED` and `USER_UPDATED` for A. Confirm the profile
   generation and current cloud preview remain stable.
5. Start two manual checks together. Confirm they share one `getSession()` call.
6. Start a check for A, then sign in as profile B before A finishes. Confirm A's
   late result is ignored and no A counts appear for B.
7. Simulate an expired session. Confirm the health card reports `Session
   expired`, the prior preview resets, and Guest mode remains usable.
8. Simulate a session-read or refresh failure. Confirm `Refresh failed`, retry
   guidance, zero old cloud counts, and a disabled local-apply/write path.
9. Retry successfully and confirm a new isolated profile lifecycle is created
   before any read-only cloud preview can run.
10. Compare exported fasting data and local sync metadata before and after the
    checks. Sessions, sync status, and sync timestamps must be unchanged.

### Resume And Reconnect Recovery Checks

1. With publishable config and the SDK ready, sign in with a throwaway profile
   and confirm the health card reports `Session healthy`.
2. Put the tab in the background, return to it, and confirm one auth-only check
   runs with `Last check source: App resumed`.
3. Repeat the background/foreground cycle within one minute. Confirm cooldown
   suppresses the duplicate check and the previous check time remains stable.
4. Switch the browser offline, return to a visible tab, and confirm no session
   check runs while offline.
5. Restore connectivity with the tab visible. Confirm one auth-only check runs
   with `Last check source: Connection restored`.
6. Restore connectivity while the tab is hidden. Confirm no check runs until a
   later visible signal passes readiness and cooldown.
7. Start a resume check for profile A, then switch to profile B before it
   finishes. Confirm A's late completion is ignored and no A preview state is
   visible for B.
8. Trigger a same-user token refresh and confirm the profile lifecycle and
   preview scope stay stable.
9. Inspect the UI and serialized health/recovery models. Confirm no user id,
   provider token, access token, or refresh token is present.
10. Compare fasting sessions and sync metadata before and after all checks.
    They must be unchanged, and every local apply/write action must stay
    disabled.

### Two-Profile RLS Verification

Use two throwaway profiles with clearly different test rows. Never use personal
fasting records for this check.

1. Create throwaway profiles A and B through the configured Google provider.
2. Insert one recognizable `fast_sessions` row for A and a different row for B.
3. Sign in as A and refresh the read-only preview.
4. Confirm the report shows only A's cloud-row count and that local apply and
   cloud writes remain disabled.
5. Start another A refresh, then sign out before it finishes.
6. Confirm the report resets cloud rows, duplicates, and invalid rows to zero
   while retaining the Local sessions count.
7. Sign in as B and refresh the preview.
8. Confirm no A row, count, blocker, or stale completion appears for B.
9. Confirm B sees only B's row. If A's row appears, stop validation and review
   the `fast_sessions` select RLS policy before doing anything else.
10. Sign B out, sign A back in, and confirm the new A lifecycle does not reuse
    the previous A request or report generation.
11. Simulate an expired or failed auth refresh and confirm the preview clears,
    Guest mode and Local data remain usable, and sync metadata stays unchanged.
12. Export a local backup and compare local history before and after the full
    test. It must be unchanged.

Expected safe failures:

- Missing publishable config: SDK is not requested, cloud reads are disabled,
  and local tracking works.
- Supabase SDK or network load failure: auth and cloud reads are disabled,
  local tracking works, and reloading the page may bootstrap again.
- Missing authenticated user: cloud reads disabled, local tracking works.
- RLS or network read failure: preview is blocked, local tracking works.
- Invalid remote row: read plan fails safely, local tracking works.

This validation is still not a production sync. Passing it means read-only RLS
and row normalization are behaving correctly; it does not authorize cloud
writes or local finalization.

## Before Enabling Real Writes

Do these in order:

1. Configure Google OAuth in Supabase and Google Cloud with a throwaway test
   account first.
2. Confirm RLS is enabled for `profiles` and `fast_sessions`.
3. Verify cloud reads with read-only access before enabling any mutation path.
4. Export a local JSON backup before each migration or sync test.
5. Test guest migration with sample or throwaway fasting data.
6. Enable one write path at a time: upload, update, tombstone, then read-back
   confirmation.
7. Finalize local sync metadata only after Supabase read-back matches the
   planned writes.
8. Test offline edits on two browsers or devices, then reconnect and verify
   local-newer, remote-newer, duplicate, and tombstone decisions.
9. Keep Apple login deferred until Google auth and Supabase sync are stable.

## Recovery Expectations

Every cloud sync step must preserve an offline local copy. If a read fails, a
write is disabled, confirmation blocks, or finalization is unavailable, the
app should continue as Local data with the existing fasting history intact.

The user-facing rule is simple: cloud sync can be unavailable, but fasting
tracking cannot be unavailable because of cloud sync.

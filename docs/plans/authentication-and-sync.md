# Plan: Profiles, Authentication, And Cloud Sync

## Goal

Add optional profiles with Sign in with Apple and Google so fasting history can
sync across the web, iPhone, Mac, and Apple Watch without making authentication
a requirement to track a fast.

## Architecture Decision

Use Supabase for:

- Sign in with Apple and Google OAuth
- User profiles
- PostgreSQL fasting-session storage
- Row-level security so users can access only their own records

Keep the existing local-first data store. Start, end, edit, and delete actions
must work offline and sync when a signed-in device reconnects.

## Important Constraints

- Real OAuth requires configured provider credentials and redirect URLs.
- Production callbacks require a stable HTTPS deployment.
- Apple web OAuth requires a Services ID, signing key, and secret rotation at
  least every six months.
- Apple provides a user's full name only during the first authorization, so it
  must be captured immediately or collected during onboarding.
- OAuth secrets and signing keys must never be committed to Git.

## Phase 1: Sync-Ready Data Model

- Add stable `updatedAt` and `deletedAt` fields to fasting sessions.
- Add a local profile state with guest and authenticated modes.
- Add a sync-status model: local, syncing, synced, or error.
- Define deterministic conflict behavior using latest validated update.
- Preserve all current local data and backup compatibility.

## Phase 2: Supabase Foundation

- Create the Supabase project and local environment configuration.
- Add `profiles` and `fast_sessions` tables.
- Add row-level-security policies scoped to `auth.uid()`.
- Add migrations and seed-free schema documentation.
- Keep publishable browser configuration separate from server secrets.

## Phase 3: Authentication

- Add **Continue with Apple** and **Continue with Google**.
- Add a small profile menu with sign-out and sync state.
- Create or update the profile after first sign-in.
- Link multiple identities to one profile only through an explicit flow.
- Provide clear error and cancellation states.

## Phase 4: Guest Data Migration

When a guest signs in for the first time:

1. Preserve a local backup before migration.
2. Upload validated local sessions to the signed-in account.
3. Merge by stable session ID without duplicates.
4. Confirm the cloud copy before marking records synced.
5. Keep the local copy available for offline operation.

## Phase 5: Cross-Device Sync

- Pull the signed-in user's records on launch.
- Push validated local changes after each action.
- Sync edits and tombstoned deletions.
- Show last successful sync time.
- Test concurrent edits and offline recovery.

## Safety And Privacy

- Request only the identity scopes needed for login.
- Never store provider access tokens in fasting records.
- Never expose one user's sessions to another user.
- Do not send fasting data to analytics or third parties.
- Provide account deletion and data-export paths.
- Keep local-only mode available.

## Acceptance Criteria

- A guest can continue tracking without signing in.
- Existing local records migrate safely after first sign-in.
- Apple and Google users receive one private profile each.
- A session started on one signed-in device appears on another.
- Offline actions sync after reconnecting.
- Sign-out does not delete local or cloud history.
- Row-level-security tests prove users cannot access other profiles.
- All current local persistence tests continue to pass.

## Provider References

- [Supabase Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Sign in with Apple REST API](https://developer.apple.com/documentation/signinwithapplerestapi)

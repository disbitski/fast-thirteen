# Supabase Foundation

This project stays local-first. Supabase adds authenticated cloud sync later;
it must not become a requirement for starting, ending, correcting, or deleting
a fast.

## Scope

This foundation covers only database shape, row-level-security expectations,
and local environment placeholders. It does not configure Google, Apple, OAuth
redirects, production domains, provider secrets, service-role keys, or Apple
client secrets.

## Local Environment

Use `.env.example` as the template:

```sh
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_PROJECT_ID=
```

Only the publishable URL and anon key belong in browser-facing code. Service
role keys, OAuth provider secrets, Apple signing keys, and generated Apple
client secrets must stay outside Git.

## Tables

### `profiles`

One row per authenticated Supabase user.

- `id`: `auth.users.id`
- `display_name`: optional profile display name
- `email`: optional email copied from auth metadata when available
- `provider`: first linked provider, currently planned as `google` or `apple`
- `created_at` and `updated_at`

### `fast_sessions`

One row per local Fast Thirteen session for a user.

- `id`: client-generated session id from the local app
- `user_id`: owning Supabase user
- `started_at`, `ended_at`, `target_hours`
- `updated_at`: conflict-resolution timestamp from the local model
- `deleted_at`: tombstone timestamp for sync-safe deletion
- `created_at`

The primary key is `(user_id, id)` so two users can never collide on a client
session id.

## Row-Level Security

RLS must be enabled on both tables before cloud sync ships.

- Users may select, insert, and update only their own profile row.
- Users may select, insert, update, and delete only their own fasting sessions.
- Queries must scope by `auth.uid()`.
- The app should tombstone sessions with `deleted_at` instead of hard deleting
  during normal sync.

## Conflict Behavior

The local data model remains the source of truth for conflict semantics:

1. Newer `updated_at` wins.
2. When timestamps tie, a tombstone wins over an active/completed record.
3. Corrected sessions update `started_at`, `ended_at`, and `updated_at`.
4. Cloud sync must not resurrect tombstoned sessions.

## Next Implementation Step

After the schema is reviewed, add a small Supabase client wrapper that can be
disabled when environment values are missing. The app should continue to show
`Guest mode · Local data` until the user explicitly signs in.

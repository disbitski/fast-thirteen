# Fast Thirteen

A focused fasting tracker built around one simple daily goal: fast for at
least 13 hours.

The first milestone is a dependency-free web MVP. It can start and end a fast,
store sessions in the browser, and summarize progress. The domain logic is
kept separate so it can later be shared conceptually with iPhone, Mac, and
Apple Watch clients.

## Features

- Start and end a fast with one button
- Live elapsed-time display
- Clear active-state styling and a live running-fast history row
- 13-hour target progress
- Completed-fast count, total hours, and current streak
- Recent-session history
- Completed-session details with timestamp correction and confirmed deletion
- Browser-local persistence
- Guest profile and local-only sync status foundations
- Optional Google sign-in scaffold that stays disabled without Supabase config
- Persistent light, black/cyan, black/purple, and SpaceX themes
- Configurable fasting goals captured per session
- Versioned local data with migration from the original storage format
- JSON backup export and restore

## Run Locally

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173).

The local server disables browser caching so the current app code is always
used after a reload.

Run the domain tests:

```sh
npm test
```

## Local Data

Fast Thirteen stores active and completed fasts in a local file on the Mac
running the server, with browser storage as a fallback. Closing the tab,
restarting the browser, restarting the local server, or switching between the
localhost and LAN URLs will not remove that data.

The local data format is sync-ready: sessions carry `updatedAt` and `deletedAt`
fields, backups include guest profile metadata, and sync status is tracked even
while the app remains local-only.

Other devices on the same network can use the Mac's LAN URL while the server
is running. They will share the same fasting history.

Use **Export data** periodically to create a JSON backup. Browser storage can
still be lost if site data is manually cleared or the browser profile is
removed.

## Supabase Foundation

Schema and row-level-security planning lives in
[`docs/supabase-foundation.md`](docs/supabase-foundation.md). The committed
`.env.example` contains placeholders only; real OAuth secrets, service-role
keys, and Apple signing material must stay outside Git.

The local server exposes `/config.js` with only browser-publishable Supabase
values: `SUPABASE_URL` and `SUPABASE_ANON_KEY`. If either value is missing,
authentication is disabled and local-only tracking continues to work.

Google OAuth setup readiness lives in
[`docs/google-oauth-readiness.md`](docs/google-oauth-readiness.md). It documents
the Supabase and Google Cloud steps without committing credentials.

## Roadmap

- Reminders and target-reached notifications
- Personal analytics dashboard with weekly and monthly fasting trends
- Authentication and cloud synchronization
- SwiftUI apps for iPhone, Mac, and Apple Watch
- Widgets, complications, and target-reached notifications

## Health Note

Fast Thirteen is a personal tracking tool, not medical advice. Fasting is not
appropriate for everyone; consult a qualified healthcare professional when
needed.

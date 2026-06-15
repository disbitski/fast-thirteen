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
- Persistent light, black/cyan, and black/purple themes
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

Other devices on the same network can use the Mac's LAN URL while the server
is running. They will share the same fasting history.

Use **Export data** periodically to create a JSON backup. Browser storage can
still be lost if site data is manually cleared or the browser profile is
removed.

## Roadmap

- Reminders and target-reached notifications
- Authentication and cloud synchronization
- SwiftUI apps for iPhone, Mac, and Apple Watch
- Widgets, complications, and target-reached notifications

## Health Note

Fast Thirteen is a personal tracking tool, not medical advice. Fasting is not
appropriate for everyone; consult a qualified healthcare professional when
needed.

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
- 13-hour target progress
- Completed-fast count, total hours, and current streak
- Recent-session history
- Browser-local persistence

## Run Locally

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173).

Run the domain tests:

```sh
npm test
```

## Roadmap

- Edit and delete sessions
- Configurable fasting goal and reminders
- Authentication and cloud synchronization
- SwiftUI apps for iPhone, Mac, and Apple Watch
- Widgets, complications, and target-reached notifications

## Health Note

Fast Thirteen is a personal tracking tool, not medical advice. Fasting is not
appropriate for everyone; consult a qualified healthcare professional when
needed.


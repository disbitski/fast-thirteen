# Plan: Personal Analytics Dashboard

## Goal

Turn accumulated fasting history into useful personal insight without making the
home page feel crowded.

## Product Direction

- Keep the home page focused on today's fast and a short recent-history list.
- Show roughly the most recent week of completed fasts on the home page.
- Add a dedicated analytics view for longer-term trends.
- Keep all analytics local to the user's fasting data. Do not send fasting
  history to external analytics services.

## First Charts

- Fasting hours over time by day.
- Weekly total fasting hours.
- Goal completion rate by week.
- Current streak and longest streak.
- Average fast length over the selected range.

## Interaction Ideas

- Add a simple **Analytics** tab or screen switcher.
- Start with week and month ranges before adding custom ranges.
- Make chart labels readable on iPhone-sized screens.
- Let deleted/tombstoned sessions stay excluded from all charts.
- Keep corrected sessions reflected immediately in the charts.

## Technical Notes

- Build chart data from the existing normalized session history.
- Reuse the domain layer for duration and completion calculations.
- Prefer lightweight SVG or CSS-driven charts before adding a chart dependency.
- Keep the analytics data model compatible with future cloud sync.

## Acceptance Criteria

- Home page history stays short and scannable.
- Analytics view shows clear trends across more than one week.
- Correcting or deleting a fast updates analytics after reload.
- Tests cover chart-data aggregation, deleted sessions, and corrected sessions.
- Mobile layout remains readable in light, black/cyan, and black/purple themes.

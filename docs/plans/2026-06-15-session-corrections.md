# Plan: Session Corrections And History Management

Date: 2026-06-15

## Goal

Make Fast Thirteen trustworthy after its first real overnight use by allowing
mistimed or forgotten taps to be corrected without losing history.

## Start With Real-World Feedback

Before changing code, review the first overnight fast:

- Did the active fast survive until morning?
- Was the timer and target-time copy understandable?
- Did ending the fast create the expected history entry?
- Did totals and streaks feel correct?
- Was anything awkward on the device used overnight?

Fix any blocker discovered here before beginning the planned feature.

## Feature Scope

### 1. Session Details

- Add an accessible **Edit** action to each completed history row.
- Show start time, end time, duration, target, and completion status.

### 2. Correct A Session

- Allow start and end date/time corrections.
- Reject an end time before the start time.
- Preserve the target captured when the fast began.
- Recalculate duration, completion status, totals, and streaks after saving.

### 3. Delete A Session

- Add a deliberate delete action inside the edit view.
- Require confirmation before deleting.
- Recalculate dashboard statistics after deletion.

## Data Safety

- Keep corrections in the existing versioned local-data format.
- Save only validated timestamps.
- Do not silently rewrite unrelated sessions.
- Verify exported backups contain corrected records.
- Keep import compatibility with today's backup format.

## Tests

- Correcting timestamps updates duration and completion status.
- Invalid timestamp ranges are rejected.
- Deleting a session removes only the selected record.
- Totals and streaks recalculate after edits and deletes.
- Corrected records survive reload and server restart.
- Existing storage migration and backup tests continue to pass.

## Browser Verification

- Complete one edit and one delete flow.
- Verify keyboard-accessible controls and visible validation errors.
- Check light, black/cyan, and black/purple themes.
- Check desktop and mobile layouts.
- Confirm there are no browser console errors.

## Definition Of Done

- First-fast feedback is addressed.
- A completed fast can be safely edited or deleted.
- Dashboard statistics reflect corrected history.
- All automated tests pass.
- Browser verification passes.
- The completed work is committed and pushed.

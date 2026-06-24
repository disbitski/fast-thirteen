function countActions(candidates) {
  return candidates.reduce(
    (counts, candidate) => ({
      ...counts,
      [candidate.action]: (counts[candidate.action] ?? 0) + 1,
    }),
    {},
  );
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countVerb(count, singular, plural) {
  return count === 1 ? singular : plural;
}

function stat(label, value, tone = "neutral") {
  return { label, tone, value: String(value) };
}

function disabledConfirmation(label = "Migration confirmation disabled") {
  return {
    disabled: true,
    label,
    message: "Cloud migration execution is not enabled in this local preview.",
  };
}

function confirmationModel(readiness) {
  if (readiness?.canWrite === true && readiness?.canConfirm === true) {
    return {
      disabled: false,
      label: "Confirm migration",
      message: "Migration execution and read-back confirmation are explicitly enabled.",
    };
  }

  return disabledConfirmation("Confirm migration unavailable");
}

export function createMigrationPreviewModel(plan, { migrationReadiness = null } = {}) {
  const actionCounts = countActions(plan?.uploadCandidates ?? []);
  const summary = plan?.summary ?? {};
  const authRequired = plan?.blockers?.includes("authenticated-user-required");
  const invalidBlocked = plan?.blockers?.includes("invalid-local-sessions");
  const backupReady = Boolean(plan?.backup && plan?.backupCreatedAt);
  const uploadCount = actionCounts.upload ?? 0;
  const updateCount = actionCounts.update ?? 0;
  const tombstoneCount = actionCounts.tombstone ?? 0;
  const duplicateCount = summary.duplicateCount ?? 0;
  const activeSkippedCount = summary.activeSkippedCount ?? 0;
  const invalidCount = summary.invalidCount ?? 0;

  const stats = [
    stat("Backup", backupReady ? "Ready" : "Missing", backupReady ? "good" : "warn"),
    stat("Upload", uploadCount),
    stat("Update", updateCount),
    stat("Delete", tombstoneCount),
    stat("Skipped", summary.skipCount ?? 0),
    stat("Invalid", invalidCount, invalidCount > 0 ? "warn" : "neutral"),
  ];

  if (authRequired) {
    return {
      details: [
        "Local data stays on this Mac until you sign in.",
        "No cloud writes happen from this preview.",
      ],
      stats,
      status: "auth-required",
      title: "Sign in to preview migration",
      message: `${countLabel(summary.localSessions ?? 0, "local session")} ready for a dry-run review after Google sign-in.`,
      confirmation: disabledConfirmation("Sign in before migration"),
    };
  }

  if (invalidBlocked) {
    return {
      details: [
        `${countLabel(invalidCount, "invalid session")} need review before migration can run.`,
        `${countLabel(plan.uploadCandidates?.length ?? 0, "valid change")} can still be previewed.`,
      ],
      stats,
      status: "blocked",
      title: "Review local history first",
      message: "The dry run found local records that need cleanup before any future cloud sync.",
      confirmation: disabledConfirmation("Resolve blockers first"),
    };
  }

  if (plan?.status === "ready") {
    return {
      details: [
        `${countLabel(uploadCount, "new fast")} would upload.`,
        `${countLabel(updateCount, "local edit")} would update cloud history.`,
        `${countLabel(tombstoneCount, "deleted fast")} would stay deleted.`,
        `${countLabel(duplicateCount, "duplicate")} would be skipped.`,
        `${countLabel(activeSkippedCount, "active fast")} ${countVerb(activeSkippedCount, "stays", "stay")} local until completed.`,
      ],
      stats,
      status: "ready",
      title: "Migration preview ready",
      message: "This dry run shows what would sync after sign-in. It does not write to Supabase yet.",
      confirmation: confirmationModel(migrationReadiness),
    };
  }

  return {
    details: [
      `${countLabel(duplicateCount, "duplicate")} already ${countVerb(duplicateCount, "matches", "match")} cloud history.`,
      `${countLabel(activeSkippedCount, "active fast")} ${countVerb(activeSkippedCount, "stays", "stay")} local until completed.`,
      "No cloud writes happen from this preview.",
    ],
    stats,
    status: "empty",
    title: "Nothing to migrate yet",
    message: "Your local history is backed up and there are no completed changes waiting to upload.",
    confirmation: disabledConfirmation("Nothing to migrate"),
  };
}

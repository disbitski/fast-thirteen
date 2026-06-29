function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countVerb(count, singular, plural) {
  return count === 1 ? singular : plural;
}

function stat(label, value, tone = "neutral") {
  return { label, tone, value: String(value) };
}

function formatSyncTime(value) {
  if (!value) return "Never synced";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function decisionCount(plan, reason) {
  return (plan?.decisions ?? []).filter((decision) => decision.reason === reason).length;
}

function sourceCount(plan, source) {
  return (plan?.decisions ?? []).filter((decision) => decision.source === source).length;
}

function disabledAction(label = "Read-only preview") {
  return {
    disabled: true,
    label,
    message: "Cloud reads are preview-only here and no cloud writes will run.",
  };
}

function applyAction(plan, applyReadiness) {
  if (plan?.status === "ready" && plan.canApply === true && applyReadiness?.canApply) {
    return {
      disabled: false,
      label: "Apply cloud read",
      message: applyReadiness.message ?? "This successful read plan can update the local offline copy.",
    };
  }

  return {
    disabled: true,
    label: "Apply disabled",
    message:
      applyReadiness?.message ??
      "Applying cloud reads is disabled until local finalization support is explicitly enabled.",
  };
}

export function createSyncPreviewModel(plan, { applyReadiness = null, readiness = null } = {}) {
  const summary = plan?.summary ?? {};
  const localSessions = summary.localSessions ?? plan?.data?.sessions?.length ?? 0;
  const remoteSessions = summary.remoteSessions ?? 0;
  const duplicateCount = summary.duplicateCount ?? decisionCount(plan, "duplicate");
  const remoteAppliedCount = summary.remoteAppliedCount ?? sourceCount(plan, "remote");
  const localKeptCount = summary.localKeptCount ?? sourceCount(plan, "local");
  const tombstoneCount = summary.tombstoneCount ?? 0;
  const lastSyncedAt = plan?.syncStatus?.current?.lastSyncedAt ?? null;
  const nextSyncedAt = plan?.syncStatus?.next?.lastSyncedAt ?? null;

  const stats = [
    stat("Readiness", readiness?.canRead ? "Ready" : "Disabled", readiness?.canRead ? "good" : "warn"),
    stat("Local", localSessions),
    stat("Remote", remoteSessions),
    stat("Apply", remoteAppliedCount),
    stat("Keep local", localKeptCount),
    stat("Duplicates", duplicateCount),
  ];

  if (!readiness?.canRead) {
    return {
      action: disabledAction("Cloud read disabled"),
      details: [
        readiness?.message ?? "Cloud reads need a signed-in profile and Supabase browser config.",
        "Local tracking, backups, and the current offline copy stay unchanged.",
      ],
      lastSync: `Last successful sync: ${formatSyncTime(lastSyncedAt)}`,
      stats,
      status: "disabled",
      title: "Cloud sync preview disabled",
      message: "Sign in with configured Supabase auth before reading cloud fasting history.",
    };
  }

  if (plan?.status === "failed") {
    return {
      action: disabledAction("Resolve read blocker"),
      details: [
        plan.message ?? "Cloud fasting history could not be read safely.",
        `${countLabel(localSessions, "local session")} ${countVerb(localSessions, "remains", "remain")} available offline.`,
        "Local sync status is not changed until a read plan succeeds.",
      ],
      lastSync: `Last successful sync: ${formatSyncTime(lastSyncedAt)}`,
      stats,
      status: "blocked",
      title: "Cloud read needs review",
      message: "The read-only planner found a blocker before merging remote fasting history.",
    };
  }

  return {
    action: applyAction(plan, applyReadiness),
    details: [
      `${countLabel(remoteAppliedCount, "remote change")} would merge into local history.`,
      `${countLabel(localKeptCount, "local edit")} ${countVerb(localKeptCount, "stays", "stay")} newer than cloud history.`,
      `${countLabel(duplicateCount, "duplicate")} would be skipped by stable session id.`,
      `${countLabel(tombstoneCount, "deleted fast")} ${countVerb(tombstoneCount, "stays", "stay")} deleted after the merge.`,
    ],
    lastSync: `Preview sync time: ${formatSyncTime(nextSyncedAt)}`,
    stats,
    status: "ready",
    title: "Cloud read preview ready",
    message: "This read-only preview shows how signed-in cloud history would merge locally. It does not write to Supabase.",
  };
}

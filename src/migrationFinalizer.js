import { normalizeData } from "./storage.js";

export function createFinalizationReadiness({ migrationReadiness = null } = {}) {
  if (
    migrationReadiness?.canWrite === true &&
    migrationReadiness?.canConfirm === true &&
    migrationReadiness?.canFinalize === true
  ) {
    return {
      canFinalize: true,
      message: "Migration write, read-back, and local finalization support are explicitly enabled.",
      status: "ready",
    };
  }

  return {
    canFinalize: false,
    message: "Migration finalization is disabled until write, read-back, and local sync updates are explicitly enabled.",
    status: "disabled",
  };
}

function unchangedResult(localData, code, message) {
  return {
    backup: null,
    code,
    data: normalizeData(localData),
    message,
    status: "blocked",
    syncUpdated: false,
  };
}

function confirmedExecution(execution) {
  return (
    execution?.status === "executed" &&
    execution?.confirmation?.status === "confirmed" &&
    execution?.confirmation?.canMarkSynced === true
  );
}

export function finalizeConfirmedMigration({
  execution,
  localData,
  migrationPlan,
  now = new Date(),
} = {}) {
  if (!confirmedExecution(execution)) {
    return unchangedResult(
      localData,
      "confirmation-required",
      "Local sync metadata stays unchanged until migration read-back confirmation passes.",
    );
  }

  if (!migrationPlan?.backup || !migrationPlan?.backupCreatedAt) {
    return unchangedResult(
      localData,
      "backup-required",
      "Local sync metadata stays unchanged until the migration backup is preserved.",
    );
  }

  const timestamp = new Date(now).toISOString();
  const normalized = normalizeData(localData);
  const data = normalizeData({
    ...normalized,
    sync: {
      status: "synced",
      lastSyncedAt: timestamp,
      lastError: null,
      updatedAt: timestamp,
    },
    sessions: normalized.sessions,
  });

  return {
    backup: {
      createdAt: migrationPlan.backupCreatedAt,
      data: migrationPlan.backup,
      preserved: true,
    },
    code: null,
    data,
    message: "Migration confirmed. Local data remains available offline and sync metadata can be marked synced.",
    status: "finalized",
    syncUpdated: true,
  };
}

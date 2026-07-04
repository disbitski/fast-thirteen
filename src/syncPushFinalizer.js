import { normalizeData, serializeBackup } from "./storage.js";

export function createPushFinalizationReadiness({
  finalizationEnabled = false,
  pushReadiness = null,
  repositoryReadiness = null,
} = {}) {
  if (
    finalizationEnabled === true &&
    pushReadiness?.canWrite === true &&
    repositoryReadiness?.canWrite === true &&
    repositoryReadiness?.canConfirm === true
  ) {
    return {
      canFinalize: true,
      message: "Cloud push write, read-back confirmation, and local finalization support are explicitly enabled.",
      reason: null,
      status: "ready",
    };
  }

  return {
    canFinalize: false,
    message: "Cloud push finalization is disabled until write, read-back confirmation, and local sync updates are explicitly enabled.",
    reason: "finalization-support-disabled",
    status: "disabled",
  };
}

function unchangedResult({ code, finalizationReadiness, localData, message, status = "blocked" }) {
  return {
    backup: null,
    code,
    data: normalizeData(localData),
    finalizationReadiness,
    localDataMutated: false,
    message,
    status,
    syncUpdated: false,
  };
}

function confirmedPushExecution(execution) {
  return (
    execution?.status === "executed" &&
    execution.executed === true &&
    execution?.confirmation?.status === "confirmed" &&
    execution?.confirmation?.canMarkSynced === true
  );
}

export function finalizeConfirmedCloudPush({
  execution,
  finalizationReadiness = createPushFinalizationReadiness(),
  localData,
  now = new Date(),
} = {}) {
  if (!finalizationReadiness?.canFinalize) {
    return unchangedResult({
      code: finalizationReadiness?.reason ?? "finalization-disabled",
      finalizationReadiness,
      localData,
      message: finalizationReadiness?.message ?? "Cloud push finalization is disabled.",
      status: "disabled",
    });
  }

  if (!confirmedPushExecution(execution)) {
    return unchangedResult({
      code: "confirmation-required",
      finalizationReadiness,
      localData,
      message: "Local sync metadata stays unchanged until cloud push read-back confirmation passes.",
    });
  }

  const timestamp = new Date(now).toISOString();
  const current = normalizeData(localData);
  const backup = serializeBackup(current);
  const data = normalizeData({
    ...current,
    sync: {
      status: "synced",
      lastSyncedAt: timestamp,
      lastError: null,
      updatedAt: timestamp,
    },
    sessions: current.sessions,
  });

  return {
    backup: {
      createdAt: timestamp,
      data: backup,
      preserved: true,
    },
    code: null,
    data,
    finalizationReadiness,
    localDataMutated: true,
    message: "Cloud push confirmed. Local offline data is preserved and sync metadata can be marked synced.",
    status: "finalized",
    syncUpdated: true,
  };
}

export function createCloudPushFinalizationStatusModel(result) {
  const finalized = result?.status === "finalized" && result.syncUpdated === true;

  if (finalized) {
    return {
      action: {
        disabled: true,
        label: "Push sync finalized",
        message: "Local sync metadata was updated after backup and read-back confirmation.",
      },
      details: [
        "A local backup was preserved before sync metadata changed.",
        "The offline fasting history remains available on this device.",
      ],
      message: result.message,
      status: "finalized",
      title: "Cloud push finalized",
    };
  }

  if (result?.status === "disabled") {
    return {
      action: {
        disabled: true,
        label: "Finalization disabled",
        message: "Local tracking still works while cloud finalization is disabled.",
      },
      details: [
        result.message ?? "Cloud push finalization is disabled.",
        "No local fasting data or sync metadata was changed.",
      ],
      message: result?.message ?? "Cloud push finalization is disabled.",
      status: "disabled",
      title: "Cloud push finalization disabled",
    };
  }

  return {
    action: {
      disabled: true,
      label: "Confirmation required",
      message: "Local sync metadata stays unchanged until read-back confirmation passes.",
    },
    details: [
      result?.message ?? "Cloud push finalization is blocked.",
      "No local fasting data or sync metadata was changed.",
    ],
    message: result?.message ?? "Cloud push finalization is blocked.",
    status: "blocked",
    title: "Cloud push finalization blocked",
  };
}

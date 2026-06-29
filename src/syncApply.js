import { normalizeData, serializeBackup } from "./storage.js";

export function syncApplyReadiness({ enabled = false } = {}) {
  if (!enabled) {
    return {
      canApply: false,
      message: "Applying cloud reads is disabled until local finalization support is explicitly enabled.",
      reason: "apply-support-disabled",
      status: "disabled",
    };
  }

  return {
    canApply: true,
    message: "Successful cloud read plans can be applied to the local offline copy.",
    reason: null,
    status: "ready",
  };
}

function blockedResult({ localData, message, plan = null, status = "blocked" }) {
  return {
    applied: false,
    backup: null,
    backupCreatedAt: null,
    data: normalizeData(localData),
    message,
    planStatus: plan?.status ?? null,
    status,
  };
}

function isReadyReadPlan(plan) {
  return (
    plan?.status === "ready" &&
    plan.canApply === true &&
    plan.syncStatus?.applied === true &&
    plan.data?.sync?.status === "synced"
  );
}

export function applyCloudReadPlan({
  applyReadiness = syncApplyReadiness(),
  localData,
  now = new Date(),
  plan,
} = {}) {
  if (!applyReadiness?.canApply) {
    return blockedResult({
      localData,
      message: applyReadiness?.message ?? "Applying cloud reads is disabled.",
      plan,
      status: "disabled",
    });
  }

  if (!isReadyReadPlan(plan)) {
    return blockedResult({
      localData,
      message: "Only a successful ready cloud read plan can be applied locally.",
      plan,
    });
  }

  const current = normalizeData(localData);
  const backup = serializeBackup(current);
  const backupCreatedAt = new Date(now).toISOString();
  const data = normalizeData(plan.data);

  return {
    applied: true,
    backup,
    backupCreatedAt,
    data,
    message: "Cloud read plan applied to the local offline copy after preserving a backup.",
    planStatus: plan.status,
    status: "applied",
  };
}

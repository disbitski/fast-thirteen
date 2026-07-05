import { normalizeData } from "./storage.js";

function reasonOf(value, fallback) {
  return value?.reason ?? value?.status ?? fallback;
}

function stage({ canProceed, message, name, reason, status }) {
  return {
    canProceed: Boolean(canProceed),
    message: message ?? `${name} is unavailable.`,
    name,
    reason: reason ?? null,
    status: status ?? (canProceed ? "ready" : "disabled"),
  };
}

function action({ enabled, label, message, reason }) {
  return {
    disabled: !enabled,
    enabled: Boolean(enabled),
    label,
    message,
    reason: enabled ? null : reason,
  };
}

function hasBlocker(model) {
  return model.blockers.length > 0;
}

function supportsCloudPreview(stages) {
  return (
    stages.pull.canProceed ||
    stages.pushPlanning.canProceed ||
    stages.pushRepository.canProceed ||
    stages.pushFinalization.canProceed
  );
}

function fullyReady(actions) {
  return (
    actions.read.enabled &&
    actions.apply.enabled &&
    actions.push.enabled &&
    actions.finalizePush.enabled
  );
}

function orchestrationStatus(model) {
  if (fullyReady(model.actions)) return "ready";
  if (hasBlocker(model)) return "blocked";
  if (supportsCloudPreview(model.stages)) return "preview";
  return "local-only";
}

function collectBlockers({ readPlan, pushPlan, stages }) {
  const blockers = [];

  if (readPlan?.status === "failed") {
    blockers.push({
      code: "cloud-read-blocked",
      message: readPlan.message ?? "Cloud read planning is blocked.",
      stage: "pull",
    });
  }

  if (pushPlan?.status === "blocked") {
    for (const blocker of pushPlan.blockers ?? ["push-plan-blocked"]) {
      blockers.push({
        code: blocker,
        message: pushPlan.message ?? "Cloud push planning is blocked.",
        stage: "pushPlanning",
      });
    }
  }

  if (stages.pushRepository.canProceed && !stages.pushFinalization.canProceed) {
    blockers.push({
      code: stages.pushFinalization.reason ?? "push-finalization-disabled",
      message: stages.pushFinalization.message,
      stage: "pushFinalization",
    });
  }

  return blockers;
}

function summaryFrom({ localData, pushPlan, readPlan }) {
  const local = normalizeData(localData);

  return {
    localSessions: local.sessions.length,
    pendingDeleteCount: pushPlan?.summary?.tombstoneCount ?? 0,
    pendingInvalidCount: pushPlan?.summary?.invalidCount ?? 0,
    pendingSkipCount: pushPlan?.summary?.skipCount ?? 0,
    pendingUpdateCount: pushPlan?.summary?.updateCount ?? 0,
    pendingUploadCount: pushPlan?.summary?.uploadCount ?? 0,
    readDuplicateCount: readPlan?.summary?.duplicateCount ?? 0,
    readRemoteApplyCount: readPlan?.summary?.remoteAppliedCount ?? 0,
    readRemoteSessions: readPlan?.summary?.remoteSessions ?? 0,
  };
}

export function createSyncOrchestrationModel({
  applyReadiness = null,
  localData,
  pushFinalizationReadiness = null,
  pushPlan = null,
  pushReadiness = null,
  pushRepositoryReadiness = null,
  readPlan = null,
  readReadiness = null,
} = {}) {
  const normalized = normalizeData(localData);
  const stages = {
    pull: stage({
      canProceed: readReadiness?.canRead === true,
      message: readReadiness?.message,
      name: "Cloud pull",
      reason: reasonOf(readReadiness, "cloud-read-disabled"),
      status: readReadiness?.status,
    }),
    apply: stage({
      canProceed: applyReadiness?.canApply === true,
      message: applyReadiness?.message,
      name: "Local apply",
      reason: reasonOf(applyReadiness, "apply-disabled"),
      status: applyReadiness?.status,
    }),
    pushPlanning: stage({
      canProceed: pushReadiness?.canPlan === true,
      message: pushReadiness?.message,
      name: "Cloud push planning",
      reason: reasonOf(pushReadiness, "push-planning-disabled"),
      status: pushReadiness?.status,
    }),
    pushRepository: stage({
      canProceed: pushRepositoryReadiness?.canWrite === true && pushRepositoryReadiness?.canConfirm === true,
      message: pushRepositoryReadiness?.message,
      name: "Cloud push repository",
      reason: reasonOf(pushRepositoryReadiness, "push-repository-disabled"),
      status: pushRepositoryReadiness?.status,
    }),
    pushFinalization: stage({
      canProceed: pushFinalizationReadiness?.canFinalize === true,
      message: pushFinalizationReadiness?.message,
      name: "Cloud push finalization",
      reason: reasonOf(pushFinalizationReadiness, "push-finalization-disabled"),
      status: pushFinalizationReadiness?.status,
    }),
  };
  const readCanApply = (
    readPlan?.status === "ready" &&
    readPlan.canApply === true &&
    stages.pull.canProceed &&
    stages.apply.canProceed
  );
  const pushCanExecute = (
    pushPlan?.status === "ready" &&
    pushReadiness?.canWrite === true &&
    stages.pushRepository.canProceed
  );
  const pushCanFinalize = pushCanExecute && stages.pushFinalization.canProceed;
  const actions = {
    read: action({
      enabled: stages.pull.canProceed,
      label: stages.pull.canProceed ? "Read cloud history" : "Cloud read disabled",
      message: stages.pull.message,
      reason: stages.pull.reason,
    }),
    apply: action({
      enabled: readCanApply,
      label: readCanApply ? "Apply cloud read" : "Apply disabled",
      message: readCanApply
        ? "A backup must be preserved before applying cloud read results locally."
        : stages.apply.message,
      reason: readCanApply ? null : stages.apply.reason,
    }),
    push: action({
      enabled: pushCanExecute,
      label: pushCanExecute ? "Push cloud changes" : "Cloud push disabled",
      message: pushCanExecute
        ? "Cloud push execution is available only with explicit write and confirmation support."
        : stages.pushRepository.message,
      reason: pushCanExecute ? null : stages.pushRepository.reason,
    }),
    finalizePush: action({
      enabled: pushCanFinalize,
      label: pushCanFinalize ? "Finalize push sync" : "Finalization disabled",
      message: pushCanFinalize
        ? "A local backup must be preserved before sync metadata is finalized."
        : stages.pushFinalization.message,
      reason: pushCanFinalize ? null : stages.pushFinalization.reason,
    }),
  };
  const model = {
    actions,
    backupExpectations: {
      applyRequiresBackup: readCanApply,
      pushFinalizationRequiresBackup: pushCanFinalize,
      preservesOfflineCopy: true,
    },
    blockers: [],
    dataMutated: false,
    localTrackingAvailable: true,
    profileMode: normalized.profile.mode,
    stages,
    summary: summaryFrom({ localData: normalized, pushPlan, readPlan }),
    syncStatus: normalized.sync,
  };

  model.blockers = collectBlockers({ readPlan, pushPlan, stages });

  return {
    ...model,
    status: orchestrationStatus(model),
  };
}

export function createSyncOrchestrationStatusModel(model) {
  const status = model?.status ?? "local-only";
  const details = [
    model?.localTrackingAvailable
      ? "Local tracking stays available regardless of cloud readiness."
      : "Local tracking is unavailable.",
    model?.backupExpectations?.preservesOfflineCopy
      ? "Apply and finalize paths preserve an offline backup before local sync metadata changes."
      : "Backup expectations are not available.",
  ];

  if (model?.blockers?.length > 0) {
    details.push(`${model.blockers.length} sync blocker${model.blockers.length === 1 ? "" : "s"} need review.`);
  }

  return {
    action: {
      disabled: !model?.actions?.finalizePush?.enabled,
      label: model?.actions?.finalizePush?.enabled ? "Sync actions ready" : "Sync actions disabled",
      message: model?.actions?.finalizePush?.enabled
        ? "Read, apply, push, confirmation, and finalization gates are explicitly enabled."
        : "Cloud sync remains preview/local-safe until every explicit gate is enabled.",
    },
    details,
    message: status === "ready"
      ? "Cross-device sync orchestration is fully gated and ready for future UI wiring."
      : status === "preview"
        ? "Cross-device sync orchestration is in preview mode. Local tracking still works."
        : status === "blocked"
          ? "Cross-device sync orchestration found blockers before local data can change."
          : "Cross-device sync orchestration is local-only until sign-in and Supabase config are ready.",
    status,
    title: status === "ready"
      ? "Sync orchestration ready"
      : status === "preview"
        ? "Sync orchestration preview"
        : status === "blocked"
          ? "Sync orchestration blocked"
          : "Sync orchestration local-only",
  };
}

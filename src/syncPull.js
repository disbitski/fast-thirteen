import { createCloudReadPlan, createFailedSyncReadPlan } from "./syncReadPlan.js";
import { createSyncPreviewModel } from "./syncPreview.js";

function missingRepositoryPlan({ localData, now, readiness }) {
  return createFailedSyncReadPlan({
    error: readiness?.message ?? "Cloud read repository is not available.",
    localData,
    now,
  });
}

function diagnosticStage({ canProceed = false, message, status }) {
  return {
    canProceed,
    message,
    status,
  };
}

export function createCloudReadApplyDiagnostics({
  applyReadiness = null,
  plan = null,
  readOutcome = "not-run",
  readiness = null,
} = {}) {
  const readEnabled = readiness?.canRead === true;
  const readSucceeded = readOutcome === "succeeded";
  const readFailed = readOutcome === "failed";
  const planReady = readSucceeded && plan?.status === "ready" && plan.canApply === true;
  const planBlocked = readSucceeded && plan?.status === "failed";
  const applyEnabled = planReady && applyReadiness?.canApply === true;
  const invalidRowCount = Array.isArray(plan?.invalidRows) ? plan.invalidRows.length : 0;
  const blockers = [];

  if (readFailed) {
    blockers.push({
      code: "repository-read-failed",
      message: plan?.message ?? "Cloud fasting history could not be read.",
      stage: "repositoryRead",
    });
  } else if (planBlocked) {
    blockers.push({
      code: invalidRowCount > 0 ? "invalid-remote-rows" : "merge-plan-blocked",
      message: plan?.message ?? "Cloud read planning is blocked.",
      stage: "mergePlan",
    });
  }

  const stages = {
    readiness: diagnosticStage({
      canProceed: readEnabled,
      message: readiness?.message ?? "Cloud read readiness is unavailable.",
      status: readEnabled ? "ready" : "disabled",
    }),
    repositoryRead: diagnosticStage({
      canProceed: readSucceeded,
      message: !readEnabled
        ? "Repository read was not attempted because cloud reads are disabled."
        : readSucceeded
          ? "Signed-in fast_sessions rows were read without changing local data."
          : readFailed
            ? plan?.message ?? "Cloud fasting history could not be read."
            : "Repository read has not run.",
      status: !readEnabled ? "not-run" : readSucceeded ? "passed" : readFailed ? "blocked" : "not-run",
    }),
    mergePlan: diagnosticStage({
      canProceed: planReady,
      message: planReady
        ? "Remote rows were validated and merged into a preview by stable session id."
        : planBlocked
          ? plan?.message ?? "Cloud read planning is blocked."
          : "Merge planning did not run because no successful repository read is available.",
      status: planReady ? "ready" : planBlocked ? "blocked" : "not-run",
    }),
    localApply: diagnosticStage({
      canProceed: applyEnabled,
      message: applyEnabled
        ? "Local apply is enabled and must preserve a backup before changing the offline copy."
        : planReady
          ? applyReadiness?.message ?? "Local apply support is disabled."
          : "Local apply cannot run without a successful read plan.",
      status: applyEnabled ? "ready" : planReady ? "gated" : "not-run",
    }),
  };

  const status = !readEnabled
    ? "disabled"
    : readFailed || planBlocked
      ? "blocked"
      : applyEnabled
        ? "apply-ready"
        : planReady
          ? "preview"
          : "waiting";

  return {
    backupRequired: applyEnabled,
    blockers,
    dataMutated: false,
    invalidRowCount,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    nextStep: status === "disabled"
      ? readiness?.message ?? "Enable cloud read readiness for a signed-in test profile."
      : status === "blocked"
        ? blockers[0]?.message ?? "Resolve the cloud read blocker before continuing."
        : status === "apply-ready"
          ? "Preserve a local backup before applying this successful read plan."
          : status === "preview"
            ? applyReadiness?.message ?? "Review the merge preview while local apply remains disabled."
            : "Run a read-only cloud pull to build a merge preview.",
    plannedSyncStatus: planReady ? plan?.syncStatus?.next?.status ?? null : null,
    profileMode: plan?.data?.profile?.mode ?? "guest",
    stages,
    status,
  };
}

function pullResult({ applyReadiness, plan, readOutcome, readiness, status }) {
  return {
    diagnostics: createCloudReadApplyDiagnostics({
      applyReadiness,
      plan,
      readOutcome,
      readiness,
    }),
    model: createSyncPreviewModel(plan, { applyReadiness, readiness }),
    plan,
    readiness,
    status,
  };
}

export async function createCloudPullPreview({
  applyReadiness = null,
  localData,
  now = new Date(),
  readiness,
  repository,
  user,
} = {}) {
  if (!readiness?.canRead) {
    const plan = createFailedSyncReadPlan({
      error: readiness?.message ?? "Cloud reads are disabled.",
      localData,
      now,
    });

    return pullResult({
      applyReadiness,
      plan,
      readOutcome: "not-run",
      readiness,
      status: "disabled",
    });
  }

  if (typeof repository?.readFastSessions !== "function") {
    const plan = missingRepositoryPlan({
      localData,
      now,
      readiness: {
        ...readiness,
        message: "Cloud read repository is not available.",
      },
    });

    return pullResult({
      applyReadiness,
      plan,
      readOutcome: "failed",
      readiness,
      status: "failed",
    });
  }

  try {
    const remoteRows = await repository.readFastSessions({ user });
    const plan = createCloudReadPlan({
      localData,
      now,
      remoteRows,
      user,
    });

    return pullResult({
      applyReadiness,
      plan,
      readOutcome: "succeeded",
      readiness,
      status: plan.status,
    });
  } catch (error) {
    const plan = createFailedSyncReadPlan({
      error: error?.message ?? "Cloud fasting history could not be read.",
      localData,
      now,
    });

    return pullResult({
      applyReadiness,
      plan,
      readOutcome: "failed",
      readiness,
      status: "failed",
    });
  }
}

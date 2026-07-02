function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function emptySummary(plan) {
  return {
    executedCount: 0,
    tombstoneCount: 0,
    updateCount: 0,
    uploadCount: 0,
    plannedCount: plan?.candidates?.length ?? 0,
  };
}

function blockedExecution({ code, message, plan, status = "blocked" }) {
  return {
    calls: [],
    code,
    confirmation: null,
    executed: false,
    localDataMutated: false,
    message,
    planStatus: plan?.status ?? null,
    status,
    summary: emptySummary(plan),
    syncUpdated: false,
    user: plan?.user ?? null,
  };
}

function methodForAction(action) {
  if (action === "upload") return "uploadSession";
  if (action === "update") return "updateSession";
  if (action === "tombstone") return "tombstoneSession";
  return null;
}

function firstBlocker(plan) {
  if (plan?.blockers?.includes("invalid-local-sessions")) return "invalid-local-sessions";
  if (plan?.blockers?.includes("invalid-remote-sessions")) return "invalid-remote-sessions";
  return plan?.blockers?.[0] ?? "push-plan-blocked";
}

function validateExecutablePlan(plan, repository) {
  if (!plan?.user?.id) {
    return blockedExecution({
      code: "authenticated-user-required",
      message: "A current authenticated user is required before cloud push execution can run.",
      plan,
    });
  }

  if (plan.readiness?.canWrite !== true) {
    return blockedExecution({
      code: "write-readiness-required",
      message: "Cloud push execution requires explicit write readiness. Local tracking stays unchanged.",
      plan,
      status: "disabled",
    });
  }

  if (plan.status === "disabled") {
    return blockedExecution({
      code: "push-plan-disabled",
      message: plan.message ?? "Cloud push plan is disabled.",
      plan,
      status: "disabled",
    });
  }

  if (plan.status === "blocked" || (plan.blockers?.length ?? 0) > 0) {
    return blockedExecution({
      code: firstBlocker(plan),
      message: "Cloud push execution is blocked until invalid records are reviewed.",
      plan,
    });
  }

  if (plan.status !== "ready") {
    return blockedExecution({
      code: "push-plan-not-ready",
      message: "Only a ready cloud push plan can be executed.",
      plan,
    });
  }

  if (typeof repository?.confirmPush !== "function") {
    return blockedExecution({
      code: "repository-method-missing",
      message: "Cloud push repository is missing confirmPush.",
      plan,
    });
  }

  for (const candidate of plan.candidates ?? []) {
    const method = methodForAction(candidate.action);
    if (!method) {
      return blockedExecution({
        code: "unknown-action",
        message: `Unsupported cloud push action: ${candidate.action}`,
        plan,
      });
    }

    if (typeof repository?.[method] !== "function") {
      return blockedExecution({
        code: "repository-method-missing",
        message: `Cloud push repository is missing ${method}.`,
        plan,
      });
    }
  }

  return null;
}

function executionSummary(calls, plan) {
  return {
    executedCount: calls.length,
    tombstoneCount: calls.filter((call) => call.action === "tombstone").length,
    updateCount: calls.filter((call) => call.action === "update").length,
    uploadCount: calls.filter((call) => call.action === "upload").length,
    plannedCount: plan?.candidates?.length ?? 0,
  };
}

export async function executeCloudPushPlan({ plan, repository } = {}) {
  const blocked = validateExecutablePlan(plan, repository);
  if (blocked) return blocked;

  const calls = [];

  for (const candidate of plan.candidates) {
    const method = methodForAction(candidate.action);
    await repository[method]({
      reason: candidate.reason,
      remoteSession: candidate.remoteSession,
      session: candidate.session,
      user: plan.user,
    });
    calls.push({ action: candidate.action, sessionId: candidate.session.id });
  }

  const confirmation = await repository.confirmPush({
    calls,
    plan,
    user: plan.user,
  });

  if (confirmation?.status !== "confirmed" || confirmation?.canMarkSynced !== true) {
    return {
      calls,
      code: "push-confirmation-blocked",
      confirmation: confirmation ?? null,
      executed: false,
      localDataMutated: false,
      message: "Cloud push confirmation did not pass. Local sync metadata stays unchanged.",
      planStatus: plan.status,
      status: "confirmation-blocked",
      summary: executionSummary(calls, plan),
      syncUpdated: false,
      user: plan.user,
    };
  }

  return {
    calls,
    code: null,
    confirmation,
    executed: true,
    localDataMutated: false,
    message: "Cloud push execution completed against the configured repository. Local sync finalization remains a separate gated step.",
    planStatus: plan.status,
    status: "executed",
    summary: executionSummary(calls, plan),
    syncUpdated: false,
    user: plan.user,
  };
}

export function createCloudPushExecutionStatusModel(execution) {
  const summary = execution?.summary ?? emptySummary();
  const stats = [
    { label: "Execution", value: execution?.executed ? "Executed" : "Blocked", tone: execution?.executed ? "good" : "warn" },
    { label: "Upload", value: String(summary.uploadCount ?? 0), tone: "neutral" },
    { label: "Update", value: String(summary.updateCount ?? 0), tone: "neutral" },
    { label: "Delete", value: String(summary.tombstoneCount ?? 0), tone: "neutral" },
    { label: "Planned", value: String(summary.plannedCount ?? 0), tone: "neutral" },
  ];

  if (execution?.status === "executed") {
    return {
      action: {
        disabled: true,
        label: "Awaiting confirmation finalization",
        message: "Local sync metadata is intentionally unchanged by this scaffold.",
      },
      details: [
        `${countLabel(summary.uploadCount ?? 0, "new fast")} uploaded through the repository adapter.`,
        `${countLabel(summary.updateCount ?? 0, "local edit")} updated through the repository adapter.`,
        `${countLabel(summary.tombstoneCount ?? 0, "deleted fast")} tombstoned through the repository adapter.`,
      ],
      message: execution.message,
      stats,
      status: "executed",
      title: "Cloud push execution scaffold completed",
    };
  }

  if (execution?.status === "confirmation-blocked") {
    return {
      action: {
        disabled: true,
        label: "Confirmation required",
        message: "Local sync metadata stays unchanged until read-back confirmation passes.",
      },
      details: [
        `${countLabel(summary.executedCount ?? 0, "repository call")} completed before confirmation blocked finalization.`,
        "No local fasting data or sync metadata was changed.",
      ],
      message: execution.message,
      stats,
      status: "blocked",
      title: "Cloud push confirmation blocked",
    };
  }

  return {
    action: {
      disabled: true,
      label: "Cloud push blocked",
      message: "Local tracking still works while cloud writes stay disabled.",
    },
    details: [
      execution?.message ?? "Cloud push execution is not available.",
      "No local fasting data or sync metadata was changed.",
    ],
    message: execution?.message ?? "Cloud push execution is blocked.",
    stats,
    status: execution?.status === "disabled" ? "disabled" : "blocked",
    title: "Cloud push execution blocked",
  };
}

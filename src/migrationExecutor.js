export class MigrationExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MigrationExecutionError";
    this.code = code;
  }
}

function requireRepositoryMethod(repository, method) {
  if (typeof repository?.[method] !== "function") {
    throw new MigrationExecutionError("repository-method-missing", `Migration repository is missing ${method}.`);
  }
}

function assertExecutablePlan(plan) {
  if (!plan?.user?.id || plan.blockers?.includes("authenticated-user-required")) {
    throw new MigrationExecutionError("authenticated-user-required", "A current authenticated user is required before migration can run.");
  }

  if (plan.blockers?.includes("invalid-local-sessions")) {
    throw new MigrationExecutionError("invalid-local-sessions", "Invalid local sessions must be reviewed before migration can run.");
  }

  if (!plan.backup || !plan.backupCreatedAt) {
    throw new MigrationExecutionError("backup-required", "A local backup is required before migration can run.");
  }

  if (!plan.canMigrate) {
    throw new MigrationExecutionError("migration-blocked", "Migration plan is blocked.");
  }
}

function candidateMethod(action) {
  if (action === "upload") return "uploadSession";
  if (action === "update") return "updateSession";
  if (action === "tombstone") return "tombstoneSession";
  throw new MigrationExecutionError("unknown-action", `Unsupported migration action: ${action}`);
}

export async function executeGuestMigrationPlan({ plan, repository } = {}) {
  assertExecutablePlan(plan);
  requireRepositoryMethod(repository, "preserveBackup");
  const executionCandidates = (plan.uploadCandidates ?? []).map((candidate) => {
    const method = candidateMethod(candidate.action);
    requireRepositoryMethod(repository, method);
    return { candidate, method };
  });

  const calls = [];
  await repository.preserveBackup({
    backup: plan.backup,
    backupCreatedAt: plan.backupCreatedAt,
    user: plan.user,
  });
  calls.push({ action: "backup", sessionId: null });

  for (const { candidate, method } of executionCandidates) {
    await repository[method]({
      cloudSession: candidate.cloudSession,
      reason: candidate.reason,
      session: candidate.session,
      user: plan.user,
    });
    calls.push({ action: candidate.action, sessionId: candidate.session.id });
  }

  return {
    calls,
    status: "executed",
    summary: {
      backupPreserved: true,
      executedCount: calls.length - 1,
      tombstoneCount: calls.filter((call) => call.action === "tombstone").length,
      updateCount: calls.filter((call) => call.action === "update").length,
      uploadCount: calls.filter((call) => call.action === "upload").length,
    },
    user: plan.user,
  };
}

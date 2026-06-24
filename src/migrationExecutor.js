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

function assertConfirmed(confirmation) {
  if (confirmation?.status !== "confirmed" || confirmation?.canMarkSynced !== true) {
    const error = new MigrationExecutionError(
      "migration-confirmation-blocked",
      "Cloud read-back confirmation must pass before local records can be marked synced.",
    );
    error.confirmation = confirmation ?? null;
    throw error;
  }
}

export async function executeGuestMigrationPlan({ plan, repository } = {}) {
  assertExecutablePlan(plan);
  requireRepositoryMethod(repository, "preserveBackup");
  requireRepositoryMethod(repository, "confirmMigration");
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

  const confirmation = await repository.confirmMigration({
    plan,
    user: plan.user,
  });
  assertConfirmed(confirmation);
  calls.push({ action: "confirm", sessionId: null });

  return {
    calls,
    confirmation,
    status: "executed",
    summary: {
      backupPreserved: true,
      confirmed: true,
      executedCount: executionCandidates.length,
      tombstoneCount: calls.filter((call) => call.action === "tombstone").length,
      updateCount: calls.filter((call) => call.action === "update").length,
      uploadCount: calls.filter((call) => call.action === "upload").length,
    },
    user: plan.user,
  };
}

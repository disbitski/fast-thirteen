import {
  PROFILE_PROVISIONING_ACTION,
  authenticatedProfileToRow,
  normalizeRemoteProfileRow,
} from "./profileProvisioning.js";
import { PROFILE_SELECT_FIELDS, PROFILES_TABLE } from "./supabaseProfileRepository.js";

export const PROFILE_WRITE_REPOSITORY_METHODS = Object.freeze([
  "createProfile",
  "updateProfile",
  "readProfile",
  "confirmProfile",
]);

export class SupabaseProfileWriteRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupabaseProfileWriteRepositoryError";
    this.code = code;
  }
}

function safetyState() {
  return {
    dataMutated: false,
    localDataUnchanged: true,
    localProfileChanged: false,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    productionWiringEnabled: false,
    providerTokensExposed: false,
    providerTokensStored: false,
  };
}

function readinessResult({
  canConfirm = false,
  canWrite = false,
  gates = {},
  message,
  reason = null,
  status = "disabled",
} = {}) {
  return Object.freeze({
    canConfirm,
    canWrite,
    gates: Object.freeze({
      clientReady: gates.clientReady === true,
      confirmationConfigured: gates.confirmationConfigured === true,
      confirmationExecutionEnabled: gates.confirmationExecutionEnabled === true,
      lifecycleReady: gates.lifecycleReady === true,
      publishableConfigReady: gates.publishableConfigReady === true,
      writeConfigured: gates.writeConfigured === true,
      writeExecutionEnabled: gates.writeExecutionEnabled === true,
    }),
    message,
    reason,
    status,
    ...safetyState(),
  });
}

function lifecycleBlocker(authState, profileScope) {
  const candidate = authenticatedProfileToRow(authState);
  if (!candidate.ok) {
    return {
      message: candidate.blockers[0].message,
      reason: candidate.blockers[0].code,
    };
  }
  if (!profileScope?.identityKey || profileScope.status !== "authenticated") {
    return {
      message: "A current authenticated lifecycle is required for profile writes.",
      reason: "authenticated-profile-scope-required",
    };
  }
  if (profileScope.userId !== candidate.row.id) {
    return {
      message: "The profile write lifecycle does not match the authenticated profile.",
      reason: "profile-scope-mismatch",
    };
  }
  return null;
}

export function supabaseProfileWriteRepositoryReadiness({
  authState,
  client = null,
  config = {},
  executeConfirmations = false,
  executeWrites = false,
  profileScope,
} = {}) {
  const baseGates = {
    clientReady: Boolean(client && typeof client.from === "function"),
    confirmationConfigured: config.profileConfirmationsEnabled === true,
    confirmationExecutionEnabled: executeConfirmations === true,
    lifecycleReady: false,
    publishableConfigReady: config?.isConfigured === true,
    writeConfigured: config.profileWritesEnabled === true,
    writeExecutionEnabled: executeWrites === true,
  };
  if (!config?.isConfigured) {
    return readinessResult({
      gates: baseGates,
      message: "Supabase publishable config is missing; profile writes are disabled.",
      reason: "publishable-config-missing",
    });
  }
  if (!client || typeof client.from !== "function") {
    return readinessResult({
      gates: baseGates,
      message: "Supabase browser client is not ready; profile writes are disabled.",
      reason: "client-missing",
    });
  }

  const blocker = lifecycleBlocker(authState, profileScope);
  if (blocker) {
    return readinessResult({
      gates: baseGates,
      message: blocker.message,
      reason: blocker.reason,
      status: "blocked",
    });
  }
  const gates = { ...baseGates, lifecycleReady: true };
  if (config.profileWritesEnabled !== true) {
    return readinessResult({
      gates,
      message: "Publishable Supabase config is present, but profile write support is disabled.",
      reason: "profile-write-support-disabled",
    });
  }
  if (executeWrites !== true) {
    return readinessResult({
      gates,
      message: "Profile write support is configured, but execution is disabled in this build.",
      reason: "profile-write-executor-disabled",
    });
  }
  if (config.profileConfirmationsEnabled !== true) {
    return readinessResult({
      gates,
      message: "Profile writes require explicit read-back confirmation support.",
      reason: "profile-confirmation-support-disabled",
    });
  }
  if (executeConfirmations !== true) {
    return readinessResult({
      gates,
      message: "Profile confirmation support is configured, but confirmation is disabled in this build.",
      reason: "profile-confirmation-executor-disabled",
    });
  }

  return readinessResult({
    canConfirm: true,
    canWrite: true,
    gates,
    message: "Profile write and read-back confirmation support are explicitly enabled for test injection.",
    status: "ready",
  });
}

function repositoryError(code, message) {
  return new SupabaseProfileWriteRepositoryError(code, message);
}

function requireAction(action) {
  if (![PROFILE_PROVISIONING_ACTION.CREATE, PROFILE_PROVISIONING_ACTION.UPDATE].includes(action)) {
    throw repositoryError("invalid-profile-action", `Unsupported profile action: ${action}`);
  }
  return action;
}

export function profileCandidateToMutation(candidate, { action, expectedUserId } = {}) {
  const normalizedAction = requireAction(action);
  const normalized = normalizeRemoteProfileRow(candidate, expectedUserId);
  if (!normalized.ok || !normalized.row.provider) {
    throw repositoryError(
      normalized.blocker?.code ?? "invalid-profile-provider",
      normalized.blocker?.message ?? "The profile candidate provider is invalid.",
    );
  }

  const row = Object.freeze({
    display_name: normalized.row.display_name,
    email: normalized.row.email,
    id: normalized.row.id,
    provider: normalized.row.provider,
    updated_at: normalized.row.updated_at,
  });
  return Object.freeze({
    action: normalizedAction,
    filter: normalizedAction === PROFILE_PROVISIONING_ACTION.UPDATE
      ? Object.freeze({ column: "id", value: normalized.row.id })
      : null,
    row,
    table: PROFILES_TABLE,
    type: normalizedAction === PROFILE_PROVISIONING_ACTION.CREATE ? "insert" : "update",
  });
}

function assertCanWrite(readiness) {
  if (!readiness.canWrite) {
    throw repositoryError("profile-writes-disabled", readiness.message);
  }
}

function assertCanConfirm(readiness) {
  if (!readiness.canConfirm) {
    throw repositoryError("profile-confirmation-disabled", readiness.message);
  }
}

async function executeQuery(query, action) {
  const response = typeof query?.throwOnError === "function"
    ? await query.throwOnError()
    : await query;
  if (response?.error) {
    throw repositoryError("supabase-profile-query-failed", response.error.message ?? `${action} failed.`);
  }
  if (response && typeof response === "object" && "data" in response) {
    return response.data;
  }
  return response ?? null;
}

function confirmationResult({ matchesPlan = false, message, reason = null, status }) {
  return Object.freeze({ matchesPlan, message, reason, status, ...safetyState() });
}

export function createSupabaseProfileWriteRepository({
  authState,
  client = null,
  config = {},
  executeConfirmations = false,
  executeWrites = false,
  profileScope,
} = {}) {
  const readiness = supabaseProfileWriteRepositoryReadiness({
    authState,
    client,
    config,
    executeConfirmations,
    executeWrites,
    profileScope,
  });
  const expectedUserId = readiness.status === "ready" ? authState.user.id : null;

  async function writeProfile(action, profile) {
    assertCanWrite(readiness);
    const mutation = profileCandidateToMutation(profile, { action, expectedUserId });
    const table = client.from(mutation.table);
    if (mutation.type === "insert") {
      if (typeof table?.insert !== "function") {
        throw repositoryError("profile-insert-missing", "The Supabase profile insert method is unavailable.");
      }
      return executeQuery(table.insert(mutation.row), "createProfile");
    }
    if (typeof table?.update !== "function") {
      throw repositoryError("profile-update-missing", "The Supabase profile update method is unavailable.");
    }
    const query = table.update(mutation.row);
    if (typeof query?.eq !== "function") {
      throw repositoryError("profile-update-filter-missing", "The profile update must be scoped by owner id.");
    }
    return executeQuery(query.eq(mutation.filter.column, mutation.filter.value), "updateProfile");
  }

  return Object.freeze({
    methods: PROFILE_WRITE_REPOSITORY_METHODS,
    readiness,
    productionWiringEnabled: false,

    async createProfile({ profile } = {}) {
      return writeProfile(PROFILE_PROVISIONING_ACTION.CREATE, profile);
    },

    async updateProfile({ profile } = {}) {
      return writeProfile(PROFILE_PROVISIONING_ACTION.UPDATE, profile);
    },

    async readProfile({ userId } = {}) {
      assertCanConfirm(readiness);
      if (userId !== expectedUserId) {
        throw repositoryError("profile-readback-owner-mismatch", "The profile read-back owner does not match the current lifecycle.");
      }
      const table = client.from(PROFILES_TABLE);
      const query = table?.select?.(PROFILE_SELECT_FIELDS)?.eq?.("id", expectedUserId);
      if (typeof query?.maybeSingle !== "function") {
        throw repositoryError("profile-readback-missing", "The Supabase profile read-back query is unavailable.");
      }
      return executeQuery(query.maybeSingle(), "readProfile");
    },

    async confirmProfile({ action, expected, remoteRow } = {}) {
      assertCanConfirm(readiness);
      requireAction(action);
      const normalized = normalizeRemoteProfileRow(remoteRow, expectedUserId);
      if (!normalized.ok || expected?.matchesPlan !== true) {
        return confirmationResult({
          message: "Profile read-back confirmation did not match the precomputed plan.",
          reason: normalized.blocker?.code ?? expected?.reason ?? "profile-confirmation-blocked",
          status: "confirmation-blocked",
        });
      }
      return confirmationResult({
        matchesPlan: true,
        message: "The current lifecycle owns the confirmed profile read-back row.",
        status: "confirmed",
      });
    },
  });
}

import { createProfileProvisioningReadiness } from "./profileProvisioning.js";

export const PROFILES_TABLE = "profiles";
export const PROFILE_SELECT_FIELDS = "id,display_name,email,provider,updated_at";

function stage(label, message, status) {
  return Object.freeze({ label, message, status });
}

function safetyState() {
  return {
    dataMutated: false,
    localDataUnchanged: true,
    localProfileChanged: false,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    profileRowWritten: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    writesEnabled: false,
  };
}

function result({ blockers = [], canRead = false, message, reason, stages, status }) {
  return Object.freeze({
    blockers: Object.freeze(blockers),
    canRead,
    canWrite: false,
    message,
    reason,
    stages: Object.freeze(stages),
    status,
    ...safetyState(),
  });
}

export function profileReadReadiness({
  authState,
  clientStatus = "not-ready",
  config = {},
  profileScope,
  readSupport = false,
} = {}) {
  const configReady = Boolean(config?.isConfigured);
  const clientReady = clientStatus === "ready";
  const authReady = authState?.status === "authenticated" && Boolean(authState.user?.id);
  const provisioning = createProfileProvisioningReadiness({
    authState,
    profileScope,
    readSupport,
  });
  const scopeReady = authReady && provisioning.reason !== "authenticated-profile-scope-required"
    && provisioning.reason !== "profile-scope-mismatch"
    && !provisioning.blockers?.some((item) => item.code?.startsWith("invalid-profile"));

  const stages = {
    config: configReady
      ? stage("Ready", "Browser-publishable Supabase config is available.", "ready")
      : stage("Missing", "Add browser-publishable Supabase config first.", "disabled"),
    client: clientReady
      ? stage("Ready", "The pinned Supabase browser client is ready.", "ready")
      : stage("Waiting", "The Supabase browser client is not ready.", "disabled"),
    auth: authReady
      ? stage("Signed in", "A token-free authenticated profile is available.", "ready")
      : stage("Guest", "Sign in with a throwaway test profile first.", "disabled"),
    scope: scopeReady
      ? stage("Isolated", "The preview is scoped to the current auth lifecycle.", "ready")
      : stage("Blocked", provisioning.message, "blocked"),
    read: readSupport === true
      ? stage("Read only", "Only the current profile row may be selected.", "ready")
      : stage("Off", "Read-only profile support is disabled in this build.", "disabled"),
  };

  if (!configReady) {
    return result({
      message: "Supabase publishable config is missing; cloud profile preview is disabled.",
      reason: "publishable-config-missing",
      stages,
      status: "disabled",
    });
  }
  if (!clientReady) {
    return result({
      message: "Supabase browser client is not ready; cloud profile preview is disabled.",
      reason: "client-not-ready",
      stages,
      status: "disabled",
    });
  }
  if (!authReady) {
    return result({
      message: "Sign in before the cloud profile row can be previewed.",
      reason: "authenticated-profile-required",
      stages,
      status: "disabled",
    });
  }
  if (!provisioning.canRead) {
    return result({
      blockers: provisioning.blockers,
      message: provisioning.message,
      reason: provisioning.reason,
      stages,
      status: provisioning.status,
    });
  }

  return result({
    canRead: true,
    message: "The current authenticated profile is ready for a read-only profiles lookup.",
    reason: null,
    stages,
    status: "ready",
  });
}

function requiredUserId(userId) {
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

export function createSupabaseProfileReadRepository({
  client = null,
  readiness = {},
} = {}) {
  return Object.freeze({
    methods: Object.freeze(["readProfile"]),
    readiness,
    writesEnabled: false,

    async readProfile({ userId } = {}) {
      if (!readiness.canRead) {
        throw new Error(readiness.message ?? "Cloud profile reads are disabled.");
      }

      const id = requiredUserId(userId);
      if (!id || typeof client?.from !== "function") {
        throw new Error("A current authenticated profile and Supabase table client are required.");
      }

      const query = client
        .from(PROFILES_TABLE)
        .select(PROFILE_SELECT_FIELDS)
        .eq("id", id);
      if (typeof query?.maybeSingle !== "function") {
        throw new Error("The Supabase profile query does not support a single-row read.");
      }

      const response = await query.maybeSingle();
      if (response?.error) {
        throw new Error(response.error.message ?? "Could not read the cloud profile row.");
      }

      return response?.data ?? null;
    },
  });
}

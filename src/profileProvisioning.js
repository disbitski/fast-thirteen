export const PROFILE_PROVISIONING_ACTION = Object.freeze({
  CREATE: "create",
  NONE: "none",
  UPDATE: "update",
});

export const PROFILE_PROVISIONING_STATUS = Object.freeze({
  BLOCKED: "blocked",
  CURRENT: "current",
  DISABLED: "disabled",
  IDLE: "idle",
  LOADING: "loading",
  PREVIEW: "preview",
});

const PROFILE_PROVIDERS = new Set(["apple", "google"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validUuid(value) {
  const id = optionalString(value);
  return id && UUID_PATTERN.test(id) ? id : null;
}

function validIso(value) {
  const candidate = optionalString(value);
  if (!candidate) return null;
  const timestamp = new Date(candidate);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function displayNameFor(user) {
  return optionalString(user?.user_metadata?.full_name)
    ?? optionalString(user?.user_metadata?.name)
    ?? optionalString(user?.email)?.split("@")[0]
    ?? "Signed in";
}

function providerFor(user) {
  return optionalString(user?.app_metadata?.provider)?.toLowerCase() ?? null;
}

function blocker(code, message) {
  return Object.freeze({ code, message });
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

export function authenticatedProfileToRow(authState) {
  const blockers = [];
  if (authState?.status !== "authenticated") {
    blockers.push(blocker(
      "authenticated-profile-required",
      "Sign in with a test profile before planning profile provisioning.",
    ));
  }

  const user = authState?.user;
  const id = validUuid(user?.id);
  if (!id) {
    blockers.push(blocker(
      "invalid-profile-id",
      "The authenticated profile id is missing or is not a valid UUID.",
    ));
  }

  const provider = providerFor(user);
  if (!PROFILE_PROVIDERS.has(provider)) {
    blockers.push(blocker(
      "invalid-profile-provider",
      "The authenticated profile provider must be Google or Apple.",
    ));
  }

  const updatedAt = validIso(user?.updated_at);
  if (!updatedAt) {
    blockers.push(blocker(
      "invalid-profile-updated-at",
      "The authenticated profile needs a valid updated_at value.",
    ));
  }

  const result = {
    blockers,
    ok: blockers.length === 0,
    row: blockers.length === 0
      ? Object.freeze({
        display_name: displayNameFor(user),
        email: optionalString(user?.email),
        id,
        provider,
        updated_at: updatedAt,
      })
      : null,
    ...safetyState(),
  };
  return Object.freeze(result);
}

export function normalizeRemoteProfileRow(row, expectedUserId) {
  if (!row || typeof row !== "object") {
    return {
      blocker: blocker("invalid-remote-profile", "The remote profile row is missing or invalid."),
      ok: false,
      row: null,
    };
  }

  const id = validUuid(row.id);
  if (!id) {
    return {
      blocker: blocker("invalid-remote-profile-id", "The remote profile id is not a valid UUID."),
      ok: false,
      row: null,
    };
  }
  if (id !== expectedUserId) {
    return {
      blocker: blocker(
        "remote-profile-owner-mismatch",
        "The remote profile belongs to another authenticated user.",
      ),
      ok: false,
      row: null,
    };
  }

  const provider = optionalString(row.provider)?.toLowerCase() ?? null;
  if (provider && !PROFILE_PROVIDERS.has(provider)) {
    return {
      blocker: blocker("invalid-remote-profile-provider", "The remote profile provider is invalid."),
      ok: false,
      row: null,
    };
  }

  const updatedAt = validIso(row.updated_at);
  if (!updatedAt) {
    return {
      blocker: blocker(
        "invalid-remote-profile-updated-at",
        "The remote profile updated_at value is invalid.",
      ),
      ok: false,
      row: null,
    };
  }

  return {
    blocker: null,
    ok: true,
    row: Object.freeze({
      display_name: optionalString(row.display_name),
      email: optionalString(row.email),
      id,
      provider,
      updated_at: updatedAt,
    }),
  };
}

function scopedProfileBlockers(candidate, profileScope) {
  if (!candidate.ok) return candidate.blockers;
  if (!profileScope?.identityKey || profileScope.status !== "authenticated") {
    return [blocker(
      "authenticated-profile-scope-required",
      "An active authenticated profile lifecycle is required for this preview.",
    )];
  }
  if (profileScope.userId !== candidate.row.id) {
    return [blocker(
      "profile-scope-mismatch",
      "The profile preview does not match the current authenticated lifecycle.",
    )];
  }
  return [];
}

export function createProfileProvisioningReadiness({
  authState,
  profileScope,
  readSupport = false,
} = {}) {
  const candidate = authenticatedProfileToRow(authState);
  const blockers = scopedProfileBlockers(candidate, profileScope);
  if (blockers.length > 0) {
    return Object.freeze({
      blockers,
      canRead: false,
      message: blockers[0].message,
      reason: blockers[0].code,
      status: PROFILE_PROVISIONING_STATUS.BLOCKED,
      ...safetyState(),
    });
  }
  if (readSupport !== true) {
    return Object.freeze({
      blockers: [],
      canRead: false,
      message: "Read-only profile lookup support is disabled in this build.",
      reason: "profile-read-support-disabled",
      status: PROFILE_PROVISIONING_STATUS.DISABLED,
      ...safetyState(),
    });
  }
  return Object.freeze({
    blockers: [],
    canRead: true,
    message: "The authenticated profile is ready for a read-only provisioning preview.",
    reason: null,
    status: "ready",
    ...safetyState(),
  });
}

function comparisonFields(row) {
  return {
    display_name: row.display_name,
    email: row.email,
    provider: row.provider,
  };
}

function changedFields(candidate, remote) {
  const expected = comparisonFields(candidate);
  const current = comparisonFields(remote);
  return Object.keys(expected).filter((field) => expected[field] !== current[field]);
}

function planMessage(status, action, reason) {
  if (status === PROFILE_PROVISIONING_STATUS.BLOCKED) {
    return "Profile provisioning preview is blocked; no profile row or Local data changed.";
  }
  if (action === PROFILE_PROVISIONING_ACTION.CREATE) {
    return "The signed-in profile would create one profiles row after writes are explicitly enabled.";
  }
  if (action === PROFILE_PROVISIONING_ACTION.UPDATE) {
    return "The newer signed-in profile metadata would update one profiles row after writes are enabled.";
  }
  if (reason === "profile-current") {
    return "The profiles row already matches the signed-in profile; no write is needed.";
  }
  return "The remote profiles row is as new or newer; no write is planned.";
}

export function createProfileProvisioningPlan({
  authState,
  profileScope,
  remoteRow,
} = {}) {
  const candidate = authenticatedProfileToRow(authState);
  const blockers = [...scopedProfileBlockers(candidate, profileScope)];
  if (remoteRow === undefined && blockers.length === 0) {
    blockers.push(blocker(
      "profile-read-required",
      "Read the current profiles row before deciding whether to create or update it.",
    ));
  }

  let action = PROFILE_PROVISIONING_ACTION.NONE;
  let changed = [];
  let reason = blockers[0]?.code ?? null;
  let remote = null;

  if (blockers.length === 0 && remoteRow === null) {
    action = PROFILE_PROVISIONING_ACTION.CREATE;
    reason = "remote-profile-missing";
  } else if (blockers.length === 0) {
    const normalized = normalizeRemoteProfileRow(remoteRow, candidate.row.id);
    if (!normalized.ok) {
      blockers.push(normalized.blocker);
      reason = normalized.blocker.code;
    } else {
      remote = normalized.row;
      changed = changedFields(candidate.row, remote);
      if (changed.length === 0) {
        reason = "profile-current";
      } else if (Date.parse(candidate.row.updated_at) > Date.parse(remote.updated_at)) {
        action = PROFILE_PROVISIONING_ACTION.UPDATE;
        reason = "authenticated-profile-newer";
      } else {
        reason = "remote-profile-newer-or-equal";
      }
    }
  }

  const status = blockers.length > 0
    ? PROFILE_PROVISIONING_STATUS.BLOCKED
    : action === PROFILE_PROVISIONING_ACTION.NONE
      ? PROFILE_PROVISIONING_STATUS.CURRENT
      : PROFILE_PROVISIONING_STATUS.PREVIEW;
  const counts = Object.freeze({
    create: action === PROFILE_PROVISIONING_ACTION.CREATE ? 1 : 0,
    invalid: blockers.length,
    noop: action === PROFILE_PROVISIONING_ACTION.NONE && blockers.length === 0 ? 1 : 0,
    update: action === PROFILE_PROVISIONING_ACTION.UPDATE ? 1 : 0,
  });

  return Object.freeze({
    action,
    blockers: Object.freeze(blockers),
    canExecute: false,
    canPreview: blockers.length === 0,
    candidate: candidate.row,
    changedFields: Object.freeze(changed),
    counts,
    identityKey: blockers.length === 0 ? profileScope.identityKey : null,
    message: planMessage(status, action, reason),
    reason,
    remote,
    status,
    ...safetyState(),
  });
}

function controllerState({
  identityKey = null,
  message = "Profile provisioning preview has not run yet.",
  plan = null,
  reason = null,
  status = PROFILE_PROVISIONING_STATUS.IDLE,
} = {}) {
  return Object.freeze({
    identityKey,
    message,
    plan,
    reason,
    status,
    ...safetyState(),
  });
}

function previewKey(profileScope, row) {
  return JSON.stringify([
    profileScope.identityKey,
    row.display_name,
    row.email,
    row.provider,
    row.updated_at,
  ]);
}

export function createProfileProvisioningPreviewController({
  onStateChange = () => {},
  readProfile,
} = {}) {
  if (typeof readProfile !== "function") {
    throw new TypeError("A read-only profile repository method is required.");
  }

  let requestId = 0;
  let activeKey = null;
  let state = controllerState();

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function invalidate({
    message = "The authenticated profile changed. Previous profile preview was cleared.",
    reason = "profile-transition",
  } = {}) {
    requestId += 1;
    activeKey = null;
    return publish(controllerState({ message, reason, status: "invalidated" }));
  }

  async function refresh({ authState, force = false, profileScope, readiness } = {}) {
    const candidate = authenticatedProfileToRow(authState);
    const blockers = scopedProfileBlockers(candidate, profileScope);
    if (!readiness?.canRead || blockers.length > 0) {
      requestId += 1;
      activeKey = null;
      const first = blockers[0];
      const disabled = publish(controllerState({
        message: first?.message ?? readiness?.message ?? "Profile preview reads are disabled.",
        reason: first?.code ?? readiness?.reason ?? "profile-read-disabled",
        status: first ? PROFILE_PROVISIONING_STATUS.BLOCKED : PROFILE_PROVISIONING_STATUS.DISABLED,
      }));
      return { accepted: false, deduplicated: false, ignored: false, state: disabled };
    }

    const key = previewKey(profileScope, candidate.row);
    const requestInFlight = activeKey === key
      && state.status === PROFILE_PROVISIONING_STATUS.LOADING;
    const completedRevision = activeKey === key && [
      PROFILE_PROVISIONING_STATUS.PREVIEW,
      PROFILE_PROVISIONING_STATUS.CURRENT,
      PROFILE_PROVISIONING_STATUS.BLOCKED,
    ].includes(state.status);
    if (requestInFlight || (!force && completedRevision)) {
      return { accepted: false, deduplicated: true, ignored: false, state };
    }

    const activeRequestId = ++requestId;
    activeKey = key;
    publish(controllerState({
      identityKey: profileScope.identityKey,
      message: "Reading the current profiles row without changing Local data.",
      status: PROFILE_PROVISIONING_STATUS.LOADING,
    }));

    let remoteRow;
    try {
      remoteRow = await readProfile({ userId: candidate.row.id });
    } catch (error) {
      if (activeRequestId !== requestId) {
        return { accepted: true, deduplicated: false, ignored: true, stale: true, state };
      }
      const blocked = publish(controllerState({
        identityKey: profileScope.identityKey,
        message: error?.message ?? "The profiles row could not be read.",
        reason: "profile-read-failed",
        status: PROFILE_PROVISIONING_STATUS.BLOCKED,
      }));
      return { accepted: true, deduplicated: false, error, ignored: false, state: blocked };
    }

    if (activeRequestId !== requestId) {
      return { accepted: true, deduplicated: false, ignored: true, stale: true, state };
    }

    const plan = createProfileProvisioningPlan({ authState, profileScope, remoteRow });
    const completed = publish(controllerState({
      identityKey: plan.identityKey,
      message: plan.message,
      plan,
      reason: plan.reason,
      status: plan.status,
    }));
    return { accepted: true, deduplicated: false, ignored: false, state: completed };
  }

  return { current, invalidate, refresh };
}

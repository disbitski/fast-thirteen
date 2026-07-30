export const PROFILE_WRITE_ACTIVATION_STATUS = Object.freeze({
  BLOCKED: "blocked",
  DISABLED: "disabled",
  NOOP: "no-op",
  READY: "ready",
  WAITING: "waiting",
});

export const PROFILE_WRITE_CONFIRMATION_PHRASE = "ENABLE THROWAWAY PROFILE WRITE";

const PLAN_ACTIONS = new Set(["create", "none", "update"]);

function stage(key, label, message, status) {
  return Object.freeze({ key, label, message, status });
}

function normalizedOrigin(location) {
  try {
    const url = new URL(location?.href ?? location?.origin);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.origin === "null") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizedOrigins(origins) {
  if (!Array.isArray(origins)) return [];
  return [...new Set(origins.map((value) => {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }).filter(Boolean))];
}

function localOrLanHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;

  const match = host.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function originCheck(location, allowedOrigins, enabled) {
  if (!enabled) {
    return {
      allowed: false,
      localOrLan: false,
      origin: null,
      stage: stage(
        "profileActivationOrigin",
        "Activation origin",
        "Origin checks remain dormant while the test-write activation switch is off.",
        "disabled",
      ),
    };
  }

  const origin = normalizedOrigin(location);
  let localOrLan = false;
  if (origin) {
    localOrLan = localOrLanHostname(new URL(origin).hostname);
  }
  const explicitlyAllowed = Boolean(
    origin && normalizedOrigins(allowedOrigins).includes(origin),
  );
  const allowed = localOrLan && explicitlyAllowed;

  if (!localOrLan) {
    return {
      allowed,
      localOrLan,
      origin,
      stage: stage(
        "profileActivationOrigin",
        "Activation origin",
        "Throwaway profile writes are restricted to an explicitly allowed local or LAN origin.",
        "blocked",
      ),
    };
  }
  if (!explicitlyAllowed) {
    return {
      allowed,
      localOrLan,
      origin,
      stage: stage(
        "profileActivationOrigin",
        "Activation origin",
        "This local or LAN origin is not in the explicit test-write allowlist.",
        "blocked",
      ),
    };
  }
  return {
    allowed,
    localOrLan,
    origin,
    stage: stage(
      "profileActivationOrigin",
      "Activation origin",
      "The current private origin is explicitly allowed for throwaway-profile rehearsal.",
      "passed",
    ),
  };
}

function lifecycleCheck(authState, profileScope, sessionHealth, enabled) {
  if (!enabled) {
    return {
      matched: false,
      stage: stage(
        "profileActivationLifecycle",
        "Activation lifecycle",
        "Authentication remains isolated from the disabled test-write policy.",
        "disabled",
      ),
    };
  }

  const matched = Boolean(
    authState?.status === "authenticated"
    && authState.user?.id
    && profileScope?.identityKey
    && profileScope.status === "authenticated"
    && profileScope.userId === authState.user.id,
  );
  if (!matched) {
    return {
      matched,
      stage: stage(
        "profileActivationLifecycle",
        "Activation lifecycle",
        "A current matching authenticated lifecycle is required.",
        "blocked",
      ),
    };
  }
  if (sessionHealth?.status === "checking") {
    return {
      matched,
      stage: stage(
        "profileActivationLifecycle",
        "Activation lifecycle",
        "Session health is still being checked.",
        "loading",
      ),
    };
  }
  if (sessionHealth?.status !== "healthy") {
    return {
      matched,
      stage: stage(
        "profileActivationLifecycle",
        "Activation lifecycle",
        "The authenticated session must be healthy before a test-write can be considered.",
        "blocked",
      ),
    };
  }
  return {
    matched,
    stage: stage(
      "profileActivationLifecycle",
      "Activation lifecycle",
      "The authenticated user, session, and isolated profile lifecycle match.",
      "passed",
    ),
  };
}

function readCheck(readEvidence, profileScope, enabled) {
  if (!enabled) {
    return {
      passed: false,
      stage: stage(
        "profileActivationRead",
        "RLS ownership proof",
        "Read-only ownership proof remains required before the test-write switch can be used.",
        "not-run",
      ),
    };
  }
  if (readEvidence?.status === "loading") {
    return {
      passed: false,
      stage: stage(
        "profileActivationRead",
        "RLS ownership proof",
        "The scoped profiles read is still running.",
        "loading",
      ),
    };
  }

  const passed = Boolean(
    readEvidence?.status === "passed"
    && readEvidence.identityKey
    && readEvidence.identityKey === profileScope?.identityKey
    && readEvidence.ownershipVerified === true
    && readEvidence.table === "profiles",
  );
  return {
    passed,
    stage: stage(
      "profileActivationRead",
      "RLS ownership proof",
      passed
        ? "The read-only profiles query passed RLS ownership checks for this lifecycle."
        : "A successful lifecycle-scoped profiles read and RLS ownership proof are required.",
      passed ? "passed" : "blocked",
    ),
  };
}

function planCheck(authState, plan, profileScope, enabled) {
  if (!enabled) {
    return {
      action: null,
      scoped: false,
      stage: stage(
        "profileActivationPlan",
        "Activation plan",
        "Create, update, or no-op planning waits for explicit test-write activation.",
        "not-run",
      ),
    };
  }

  const action = PLAN_ACTIONS.has(plan?.action) ? plan.action : null;
  const scoped = Boolean(
    action
    && plan?.identityKey
    && plan.identityKey === profileScope?.identityKey
    && plan.candidate?.id
    && plan.candidate.id === profileScope?.userId
    && plan.candidate.id === authState?.user?.id,
  );
  const passed = Boolean(scoped && plan.status !== "blocked" && !plan.blockers?.length);
  return {
    action,
    scoped,
    stage: stage(
      "profileActivationPlan",
      "Activation plan",
      passed
        ? action === "none"
          ? "The scoped profiles plan is a deterministic no-op."
          : `The lifecycle-scoped profiles ${action} plan is current.`
        : "A valid lifecycle-scoped profiles plan is required.",
      passed ? "passed" : "blocked",
    ),
  };
}

function boundaryCheck(target, fastSessionsWritesEnabled, enabled) {
  const passed = target === "profiles" && fastSessionsWritesEnabled !== true;
  return {
    passed,
    stage: stage(
      "profileActivationBoundary",
      "Mutation target",
      passed
        ? "The only permitted target is profiles; fast_sessions mutations remain disabled."
        : "The test-write policy rejects every target except profiles.",
      passed ? "passed" : enabled ? "blocked" : "disabled",
    ),
  };
}

function backupCheck(backupReadiness, enabled) {
  if (!enabled) {
    return {
      ready: false,
      stage: stage(
        "profileActivationBackup",
        "Backup marker",
        "A preserved local backup marker is required before any future test-write.",
        "not-run",
      ),
    };
  }

  const ready = Boolean(
    backupReadiness?.marker === "local-backup-preserved"
    && backupReadiness.offlineCopyAvailable === true
    && backupReadiness.preserved === true,
  );
  return {
    ready,
    stage: stage(
      "profileActivationBackup",
      "Backup marker",
      ready
        ? "A preserved local backup and offline copy are marked ready."
        : "Preserve and mark a local backup before considering a throwaway-profile write.",
      ready ? "passed" : "blocked",
    ),
  };
}

function supportCheck(repositoryReadiness, executionReadiness, action, enabled) {
  if (!enabled || !action) {
    return {
      ready: false,
      stage: stage(
        "profileActivationSupport",
        "Write / confirm support",
        "Separate write and read-back confirmation support remain inactive.",
        "not-run",
      ),
    };
  }
  if (action === "none") {
    return {
      ready: true,
      stage: stage(
        "profileActivationSupport",
        "Write / confirm support",
        "No-op plans skip repository write and confirmation support.",
        "passed",
      ),
    };
  }

  const ready = Boolean(
    repositoryReadiness?.canWrite
    && repositoryReadiness?.canConfirm
    && executionReadiness?.canExecute,
  );
  return {
    ready,
    stage: stage(
      "profileActivationSupport",
      "Write / confirm support",
      ready
        ? "Separate injected write and read-back confirmation support are ready."
        : "Write, confirmation, and executor support must all be explicitly ready.",
      ready ? "passed" : "blocked",
    ),
  };
}

function challengeCheck(challenge, profileScope, action, enabled) {
  if (!enabled || !action) {
    return {
      ready: false,
      stage: stage(
        "profileActivationChallenge",
        "Operator challenge",
        "A scoped single-use operator confirmation remains required.",
        "not-run",
      ),
    };
  }
  if (action === "none") {
    return {
      ready: true,
      stage: stage(
        "profileActivationChallenge",
        "Operator challenge",
        "No-op plans do not consume an operator confirmation.",
        "passed",
      ),
    };
  }

  const hasNonce = typeof challenge?.nonce === "string" && challenge.nonce.trim().length >= 8;
  const ready = Boolean(
    hasNonce
    && challenge.identityKey === profileScope?.identityKey
    && challenge.response === PROFILE_WRITE_CONFIRMATION_PHRASE
    && challenge.singleUse === true
    && challenge.consumed !== true,
  );
  return {
    ready,
    stage: stage(
      "profileActivationChallenge",
      "Operator challenge",
      ready
        ? "A matching unconsumed single-use operator confirmation is present."
        : challenge?.consumed === true
          ? "This single-use operator confirmation was already consumed."
          : "A matching scoped single-use operator confirmation is required.",
      ready ? "passed" : "blocked",
    ),
  };
}

function activationSwitch(enabled) {
  return stage(
    "profileActivationSwitch",
    "Activation switch",
    enabled
      ? "The code-level throwaway-profile policy switch is enabled for an injected test."
      : "The code-level throwaway-profile policy switch is hard-off in the browser app.",
    enabled ? "passed" : "disabled",
  );
}

function productionCheck(operatorTestMode) {
  return stage(
    "profileActivationProduction",
    "Browser wiring",
    operatorTestMode
      ? "Injected policy rehearsal is isolated from browser write wiring."
      : "The browser app does not construct a profile write repository or execution controller.",
    operatorTestMode ? "passed" : "disabled",
  );
}

function policyStatus(stages, action, enabled, operatorTestMode) {
  if (stages.some((item) => item.status === "loading")) {
    return PROFILE_WRITE_ACTIVATION_STATUS.WAITING;
  }
  if (action === "none" && stages.every((item) => ["disabled", "not-run", "passed"].includes(
    item.status,
  ))) {
    return PROFILE_WRITE_ACTIVATION_STATUS.NOOP;
  }
  if (stages.some((item) => item.status === "blocked")) {
    return PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED;
  }
  if (enabled && operatorTestMode && stages.every((item) => item.status === "passed")) {
    return PROFILE_WRITE_ACTIVATION_STATUS.READY;
  }
  return PROFILE_WRITE_ACTIVATION_STATUS.DISABLED;
}

function statusMessage(status, stages) {
  if (status === PROFILE_WRITE_ACTIVATION_STATUS.READY) {
    return "Every throwaway-profile activation gate passed in an injected test; browser writes remain absent.";
  }
  if (status === PROFILE_WRITE_ACTIVATION_STATUS.NOOP) {
    return "The profiles row is already current, so no activation or write is needed.";
  }
  if (status === PROFILE_WRITE_ACTIVATION_STATUS.WAITING) {
    return "The throwaway-profile activation policy is waiting for a current check.";
  }
  return stages.find((item) => ["blocked", "disabled", "not-run"].includes(item.status))
    ?.message ?? "Throwaway-profile activation remains disabled.";
}

export function createProfileWriteActivationPolicy({
  activationEnabled = false,
  allowedOrigins = [],
  authState = null,
  backupReadiness = null,
  challenge = null,
  executionReadiness = null,
  fastSessionsWritesEnabled = false,
  localData = null,
  location = globalThis.location,
  operatorTestMode = false,
  plan = null,
  profileScope = null,
  readEvidence = null,
  repositoryReadiness = null,
  sessionHealth = null,
  target = "profiles",
} = {}) {
  const enabled = activationEnabled === true;
  const origin = originCheck(location, allowedOrigins, enabled);
  const lifecycle = lifecycleCheck(authState, profileScope, sessionHealth, enabled);
  const read = readCheck(readEvidence, profileScope, enabled);
  const planState = planCheck(authState, plan, profileScope, enabled);
  const boundary = boundaryCheck(target, fastSessionsWritesEnabled, enabled);
  const backup = backupCheck(backupReadiness, enabled);
  const support = supportCheck(
    repositoryReadiness,
    executionReadiness,
    planState.action,
    enabled,
  );
  const confirmation = challengeCheck(challenge, profileScope, planState.action, enabled);
  const stages = Object.freeze([
    activationSwitch(enabled),
    origin.stage,
    lifecycle.stage,
    read.stage,
    planState.stage,
    boundary.stage,
    backup.stage,
    support.stage,
    confirmation.stage,
    productionCheck(operatorTestMode),
  ]);
  const status = policyStatus(stages, planState.action, enabled, operatorTestMode);
  const blockers = Object.freeze(stages
    .filter((item) => item.status === "blocked")
    .map((item) => Object.freeze({
      code: `${item.key}-blocked`,
      message: item.message,
      stage: item.key,
    })));

  return Object.freeze({
    action: planState.action ?? "none",
    activationReady: status === PROFILE_WRITE_ACTIVATION_STATUS.READY,
    blockers,
    checks: Object.freeze({
      backupReady: backup.ready,
      challengeReady: confirmation.ready,
      fastSessionsWritesDisabled: fastSessionsWritesEnabled !== true,
      lifecycleIsolated: lifecycle.matched,
      localDataSafe: true,
      operatorTestMode: operatorTestMode === true,
      originAllowed: origin.allowed,
      originPrivate: origin.localOrLan,
      planScoped: planState.scoped,
      productionWiringEnabled: false,
      readOwnershipVerified: read.passed,
      supportReady: support.ready,
      targetProfilesOnly: boundary.passed,
    }),
    dataMutated: false,
    fastSessionsWritesEnabled: false,
    localDataUnchanged: true,
    localSessionCount: Array.isArray(localData?.sessions) ? localData.sessions.length : 0,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: statusMessage(status, stages),
    productionWiringEnabled: false,
    profileRowWritten: false,
    profileWritesEnabled: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    safety: "Private allowlist · profiles only · backup required · single-use confirmation · Local data unchanged · Tokens omitted",
    stages,
    status,
    writeTarget: "profiles",
  });
}

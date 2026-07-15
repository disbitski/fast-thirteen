function stage(key, label, message, status) {
  return { key, label, message, status };
}

function readinessStage(key, label, value) {
  const statuses = {
    blocked: "blocked",
    cancelled: "blocked",
    disabled: "disabled",
    loading: "loading",
    ready: "passed",
  };
  return stage(
    key,
    label,
    value?.message ?? `${label} readiness is unavailable.`,
    statuses[value?.status] ?? "waiting",
  );
}

function authStage(authState, launchState) {
  if (authState?.status === "authenticated" && authState.user?.id) {
    return stage(
      "authentication",
      "Authentication",
      "Throwaway profile authenticated; provider tokens are not retained in this report.",
      "passed",
    );
  }
  if (launchState?.status === "loading" || launchState?.status === "redirecting") {
    return stage("authentication", "Authentication", launchState.message, "loading");
  }
  if (["cancelled", "failed", "blocked"].includes(launchState?.status)) {
    return stage("authentication", "Authentication", launchState.message, "blocked");
  }
  return stage(
    "authentication",
    "Authentication",
    "A configured throwaway profile must sign in before read-only validation.",
    "waiting",
  );
}

function readStage({ authenticated, diagnostics, requestState }) {
  if (!authenticated) {
    return stage(
      "repositoryRead",
      "RLS / read",
      "The fast_sessions query has not run because no test profile is authenticated.",
      "not-run",
    );
  }
  if (requestState?.status === "loading") {
    return stage(
      "repositoryRead",
      "RLS / read",
      "Reading this profile's fast_sessions rows through the read-only repository.",
      "loading",
    );
  }

  const source = diagnostics?.stages?.repositoryRead;
  if (source?.status === "passed") {
    return stage(
      "repositoryRead",
      "RLS / read",
      "Read-only fast_sessions query passed for this profile; RLS remains the access boundary.",
      "passed",
    );
  }
  if (source?.status === "blocked") {
    return stage(
      "repositoryRead",
      "RLS / read",
      source.message ?? "The read-only query or RLS policy blocked validation.",
      "blocked",
    );
  }
  return stage(
    "repositoryRead",
    "RLS / read",
    source?.message ?? "Run the read-only cloud preview to validate this profile's RLS path.",
    "not-run",
  );
}

function mergeStage(diagnostics) {
  const source = diagnostics?.stages?.mergePlan;
  if (source?.status === "ready") {
    return stage(
      "mergePreview",
      "Merge preview",
      "Remote rows were validated and merged by stable session id without applying them.",
      "passed",
    );
  }
  if (source?.status === "blocked") {
    return stage(
      "mergePreview",
      "Merge preview",
      source.message ?? "Remote rows blocked merge preview validation.",
      "blocked",
    );
  }
  return stage(
    "mergePreview",
    "Merge preview",
    source?.message ?? "Merge preview waits for a successful read-only query.",
    "not-run",
  );
}

function summaryFromPlan(plan) {
  return {
    duplicateCount: plan?.summary?.duplicateCount ?? 0,
    invalidRowCount: Array.isArray(plan?.invalidRows) ? plan.invalidRows.length : 0,
    localSessionCount: plan?.summary?.localSessions ?? 0,
    remoteSessionCount: plan?.summary?.remoteSessions ?? 0,
  };
}

export function createOAuthReadValidationReport({
  authState = null,
  launchState = null,
  oauthReadiness = null,
  pullResult = null,
  requestState = null,
} = {}) {
  const authenticated = Boolean(authState?.status === "authenticated" && authState.user?.id);
  const diagnostics = pullResult?.diagnostics ?? null;
  const plan = pullResult?.plan ?? null;
  const summary = summaryFromPlan(plan);
  const stages = [
    readinessStage("sdk", "SDK", oauthReadiness?.stages?.sdk),
    readinessStage("provider", "Provider", oauthReadiness?.stages?.provider),
    readinessStage("redirect", "Redirect", oauthReadiness?.stages?.redirect),
    authStage(authState, launchState),
    readStage({ authenticated, diagnostics, requestState }),
    mergeStage(diagnostics),
    stage(
      "localApply",
      "Local apply",
      "Disabled. A validated preview cannot change Local data or sync metadata.",
      "disabled",
    ),
    stage(
      "cloudWrites",
      "Cloud writes",
      "Disabled. Upload, update, tombstone, confirmation, and finalization cannot run.",
      "disabled",
    ),
  ];
  const readBlocked = stages.some((item) =>
    ["repositoryRead", "mergePreview"].includes(item.key) && item.status === "blocked",
  );
  const readReady = stages
    .filter((item) => ["repositoryRead", "mergePreview"].includes(item.key))
    .every((item) => item.status === "passed");
  const preflightBlocked = stages
    .filter((item) => ["sdk", "provider", "redirect"].includes(item.key))
    .some((item) => ["blocked", "disabled"].includes(item.status));
  const loading = stages.some((item) => item.status === "loading");
  const blockers = stages
    .filter((item) => item.status === "blocked")
    .map((item) => ({ code: `${item.key}-blocked`, message: item.message, stage: item.key }));

  let status = "waiting";
  let title = "Read-only validation waiting";
  let message = "Complete Google readiness and use a throwaway profile to validate cloud reads.";

  if (!authenticated && preflightBlocked) {
    status = "local-only";
    title = "Local-safe validation";
    message = "Google validation is gated. Guest mode and Local data remain fully available.";
  } else if (loading) {
    status = "loading";
    title = "Read-only validation running";
    message = "Auth or cloud-read validation is in progress without changing Local data.";
  } else if (readBlocked) {
    status = "blocked";
    title = "Read-only validation blocked";
    message = blockers[0]?.message ?? "The read-only validation path needs attention.";
  } else if (authenticated && readReady) {
    status = "ready";
    title = "Read-only validation passed";
    message = "OAuth and fast_sessions read planning passed; local apply and cloud writes remain disabled.";
  } else if (authenticated) {
    status = "authenticated";
    title = "Profile ready for read validation";
    message = "Refresh the cloud preview to validate this profile's fast_sessions read and RLS path.";
  }

  return {
    blockers,
    dataMutated: false,
    gates: {
      cloudWritesEnabled: false,
      localApplyEnabled: false,
    },
    localDataUnchanged: true,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message,
    providerTokensExposed: false,
    providerTokensStored: false,
    stages,
    status,
    summary,
    title,
  };
}

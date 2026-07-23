function stageTone(status) {
  if (status === "ready") return "good";
  if (status === "blocked") return "warn";
  return "muted";
}

function titleFor(status, action) {
  if (status === "loading") return "Checking cloud profile";
  if (status === "blocked") return "Cloud profile preview blocked";
  if (status === "disabled") return "Cloud profile preview off";
  if (action === "create") return "Profile create preview";
  if (action === "update") return "Profile update preview";
  if (status === "current") return "Cloud profile is current";
  return "Cloud profile ready to check";
}

function labelFor(status, action) {
  if (status === "loading") return "Reading";
  if (status === "blocked") return "Blocked";
  if (status === "disabled") return "Disabled";
  if (action === "create") return "Create planned";
  if (action === "update") return "Update planned";
  if (status === "current") return "No write needed";
  return "Ready";
}

export function createProfileProvisioningPreviewModel({
  readiness = {},
  requestState = null,
} = {}) {
  const scopedRequest = Boolean(
    readiness.canRead
    && requestState?.identityKey
    && requestState.status !== "invalidated",
  );
  const plan = scopedRequest ? requestState.plan : null;
  const status = !readiness.canRead
    ? readiness.status ?? "disabled"
    : requestState?.status ?? "idle";
  const action = plan?.action ?? "none";
  const counts = plan?.counts ?? { create: 0, invalid: 0, noop: 0, update: 0 };
  const message = !readiness.canRead
    ? readiness.message
    : requestState?.message ?? readiness.message;
  const stages = Object.entries(readiness.stages ?? {}).map(([key, item]) => ({
    key,
    label: item.label,
    message: item.message,
    name: key === "auth" ? "Auth" : key[0].toUpperCase() + key.slice(1),
    status: item.status,
    tone: stageTone(item.status),
  }));

  return Object.freeze({
    action,
    counts,
    dataMutated: false,
    localDataUnchanged: true,
    localSyncStatusChanged: false,
    message,
    profileRowWritten: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    safety: "Read only · Local data unchanged · Sync status unchanged · Writes disabled",
    stages: Object.freeze(stages),
    status,
    statusLabel: labelFor(status, action),
    title: titleFor(status, action),
    writesEnabled: false,
  });
}

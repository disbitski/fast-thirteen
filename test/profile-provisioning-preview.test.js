import test from "node:test";
import assert from "node:assert/strict";
import { createProfileProvisioningPreviewModel } from "../src/profileProvisioningPreview.js";

const stages = {
  auth: { label: "Signed in", message: "Auth ready.", status: "ready" },
  client: { label: "Ready", message: "Client ready.", status: "ready" },
  config: { label: "Ready", message: "Config ready.", status: "ready" },
  read: { label: "Read only", message: "Read ready.", status: "ready" },
  scope: { label: "Isolated", message: "Scope ready.", status: "ready" },
};

const ready = {
  canRead: true,
  message: "Profile lookup ready.",
  stages,
  status: "ready",
};

function state(status, action = "none") {
  return {
    identityKey: "profile:1:test-user",
    message: `${status} profile preview.`,
    plan: ["preview", "current"].includes(status)
      ? {
        action,
        counts: {
          create: action === "create" ? 1 : 0,
          invalid: 0,
          noop: action === "none" ? 1 : 0,
          update: action === "update" ? 1 : 0,
        },
      }
      : null,
    status,
  };
}

test("preview model maps disabled loading create update and current states", () => {
  const disabled = createProfileProvisioningPreviewModel({
    readiness: {
      canRead: false,
      message: "Profile preview disabled.",
      stages,
      status: "disabled",
    },
  });
  const loading = createProfileProvisioningPreviewModel({
    readiness: ready,
    requestState: state("loading"),
  });
  const create = createProfileProvisioningPreviewModel({
    readiness: ready,
    requestState: state("preview", "create"),
  });
  const update = createProfileProvisioningPreviewModel({
    readiness: ready,
    requestState: state("preview", "update"),
  });
  const current = createProfileProvisioningPreviewModel({
    readiness: ready,
    requestState: state("current"),
  });

  assert.equal(disabled.title, "Cloud profile preview off");
  assert.equal(loading.statusLabel, "Reading");
  assert.equal(create.title, "Profile create preview");
  assert.equal(create.counts.create, 1);
  assert.equal(update.title, "Profile update preview");
  assert.equal(update.counts.update, 1);
  assert.equal(current.title, "Cloud profile is current");
  assert.equal(current.statusLabel, "No write needed");
  assert.equal(current.counts.noop, 1);
});

test("blocked profile preview exposes safe guidance and stage tones", () => {
  const model = createProfileProvisioningPreviewModel({
    readiness: {
      canRead: false,
      message: "Profile scope mismatch.",
      stages: {
        ...stages,
        scope: { label: "Blocked", message: "Scope mismatch.", status: "blocked" },
      },
      status: "blocked",
    },
  });

  assert.equal(model.status, "blocked");
  assert.equal(model.statusLabel, "Blocked");
  assert.equal(model.message, "Profile scope mismatch.");
  assert.equal(model.stages.find((item) => item.key === "scope").tone, "warn");
  assert.equal(model.dataMutated, false);
  assert.equal(model.localSyncStatusChanged, false);
  assert.equal(model.writesEnabled, false);
});

test("invalidated or mismatched requests cannot leak an old profile plan", () => {
  const model = createProfileProvisioningPreviewModel({
    readiness: ready,
    requestState: {
      ...state("invalidated", "update"),
      message: "Previous profile preview cleared.",
    },
  });

  assert.equal(model.action, "none");
  assert.deepEqual(model.counts, { create: 0, invalid: 0, noop: 0, update: 0 });
  assert.equal(model.profileRowWritten, false);
});

test("preview model omits provider tokens", () => {
  const model = createProfileProvisioningPreviewModel({
    readiness: {
      ...ready,
      access_token: "must-not-escape",
    },
    requestState: {
      ...state("preview", "create"),
      provider_token: "must-not-escape",
    },
  });

  assert.doesNotMatch(
    JSON.stringify(model),
    /must-not-escape|access_token|provider_token/,
  );
  assert.equal(model.providerTokensStored, false);
});

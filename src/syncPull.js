import { createCloudReadPlan, createFailedSyncReadPlan } from "./syncReadPlan.js";
import { createSyncPreviewModel } from "./syncPreview.js";

function missingRepositoryPlan({ localData, now, readiness }) {
  return createFailedSyncReadPlan({
    error: readiness?.message ?? "Cloud read repository is not available.",
    localData,
    now,
  });
}

export async function createCloudPullPreview({
  localData,
  now = new Date(),
  readiness,
  repository,
  user,
} = {}) {
  if (!readiness?.canRead) {
    const plan = createFailedSyncReadPlan({
      error: readiness?.message ?? "Cloud reads are disabled.",
      localData,
      now,
    });

    return {
      model: createSyncPreviewModel(plan, { readiness }),
      plan,
      readiness,
      status: "disabled",
    };
  }

  if (typeof repository?.readFastSessions !== "function") {
    const plan = missingRepositoryPlan({
      localData,
      now,
      readiness: {
        ...readiness,
        message: "Cloud read repository is not available.",
      },
    });

    return {
      model: createSyncPreviewModel(plan, { readiness }),
      plan,
      readiness,
      status: "failed",
    };
  }

  try {
    const remoteRows = await repository.readFastSessions({ user });
    const plan = createCloudReadPlan({
      localData,
      now,
      remoteRows,
      user,
    });

    return {
      model: createSyncPreviewModel(plan, { readiness }),
      plan,
      readiness,
      status: plan.status,
    };
  } catch (error) {
    const plan = createFailedSyncReadPlan({
      error: error?.message ?? "Cloud fasting history could not be read.",
      localData,
      now,
    });

    return {
      model: createSyncPreviewModel(plan, { readiness }),
      plan,
      readiness,
      status: "failed",
    };
  }
}

import { createProfileExecutionController } from "./profileExecutor.js";
import { createProfileExecutionResultStatusModel } from "./profileExecutionResult.js";

function requestMeta(response = {}) {
  return Object.freeze({
    accepted: response.accepted === true,
    deduplicated: response.deduplicated === true,
    ignored: response.ignored === true,
    stale: response.stale === true,
  });
}

export function createProfileExecutionScenarioHarness({ executePlan } = {}) {
  let context = Object.freeze({ plan: null, profileScope: null });
  let latestRequest = requestMeta();
  let controllerState = null;
  const controller = createProfileExecutionController({
    ...(typeof executePlan === "function" ? { executePlan } : {}),
    onStateChange(next) {
      controllerState = next;
    },
  });

  function current() {
    return createProfileExecutionResultStatusModel({
      controllerState,
      plan: context.plan,
      profileScope: context.profileScope,
      requestMeta: latestRequest,
    });
  }

  async function execute(input = {}) {
    context = Object.freeze({
      plan: input.plan ?? null,
      profileScope: input.profileScope ?? null,
    });
    const response = await controller.execute(input);
    latestRequest = requestMeta(response);
    return Object.freeze({
      ...latestRequest,
      model: current(),
    });
  }

  function invalidate(options) {
    controller.invalidate(options);
    latestRequest = requestMeta({ ignored: true, stale: true });
    return current();
  }

  return Object.freeze({ current, execute, invalidate });
}

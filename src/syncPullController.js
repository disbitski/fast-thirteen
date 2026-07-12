function mappedStatus(result) {
  if (result?.status === "ready") return "ready";
  if (["failed", "blocked"].includes(result?.status)) return "blocked";
  if (result?.status === "disabled") return "disabled";
  return result?.status ?? "blocked";
}

function stateMessage(status, result) {
  if (status === "ready") return "Cloud preview refreshed from signed-in fasting history.";
  if (status === "disabled") return result?.plan?.message ?? "Cloud reads are disabled.";
  return result?.plan?.message ?? result?.message ?? "Cloud fasting history could not be read.";
}

export function createCloudPullRequestController({
  executePull,
  onStateChange = () => {},
} = {}) {
  if (typeof executePull !== "function") {
    throw new TypeError("A cloud pull executor is required.");
  }

  let requestId = 0;
  let state = {
    key: null,
    message: "Cloud preview has not been read yet.",
    result: null,
    status: "idle",
  };

  function publish(next) {
    state = Object.freeze(next);
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function disable(message = "Cloud reads are disabled.") {
    if (state.status === "disabled" && state.message === message) return state;

    requestId += 1;
    return publish({
      key: null,
      message,
      result: null,
      status: "disabled",
    });
  }

  async function refresh({ force = false, key, readiness, ...input } = {}) {
    if (!readiness?.canRead) {
      const disabledState = disable(readiness?.message);
      return {
        accepted: false,
        deduplicated: false,
        ignored: false,
        state: disabledState,
      };
    }

    if (!force && state.key === key && ["loading", "ready", "blocked"].includes(state.status)) {
      return {
        accepted: false,
        deduplicated: true,
        ignored: false,
        state,
      };
    }

    const activeRequestId = ++requestId;
    const previousResult = state.key === key ? state.result : null;
    publish({
      key,
      message: "Reading signed-in cloud history without changing local data.",
      result: previousResult,
      status: "loading",
    });

    let result;
    try {
      result = await executePull({ ...input, readiness });
    } catch (error) {
      if (activeRequestId !== requestId) {
        return {
          accepted: true,
          deduplicated: false,
          ignored: true,
          stale: true,
          state,
        };
      }

      const blockedState = publish({
        key,
        message: error?.message ?? "Cloud fasting history could not be read.",
        result: null,
        status: "blocked",
      });
      return {
        accepted: true,
        deduplicated: false,
        error,
        ignored: false,
        state: blockedState,
      };
    }

    if (activeRequestId !== requestId) {
      return {
        accepted: true,
        deduplicated: false,
        ignored: true,
        stale: true,
        state,
      };
    }

    const status = mappedStatus(result);
    const completedState = publish({
      key,
      message: stateMessage(status, result),
      result,
      status,
    });

    return {
      accepted: true,
      deduplicated: false,
      ignored: false,
      state: completedState,
    };
  }

  return {
    current,
    disable,
    refresh,
  };
}

import {
  createBrowserSupabaseClient,
  getSupabaseCreateClient,
} from "./supabaseClient.js";

export const SUPABASE_BROWSER_SDK_VERSION = "2.105.3";
export const SUPABASE_BROWSER_SDK_URL =
  `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_BROWSER_SDK_VERSION}`;

function bootstrapResult({ client = null, error = null, message, status }) {
  return {
    client,
    dataMutated: false,
    error,
    localTrackingAvailable: true,
    message,
    sdkUrl: SUPABASE_BROWSER_SDK_URL,
    sdkVersion: SUPABASE_BROWSER_SDK_VERSION,
    status,
  };
}

function disabledResult() {
  return bootstrapResult({
    message: "Supabase config is missing. Guest mode and Local data remain available.",
    status: "disabled",
  });
}

function loadingResult() {
  return bootstrapResult({
    message: `Loading the pinned Supabase browser SDK (${SUPABASE_BROWSER_SDK_VERSION}).`,
    status: "loading",
  });
}

function failedResult(error) {
  return bootstrapResult({
    error,
    message: "Supabase browser SDK could not load. Guest mode and Local data remain available.",
    status: "error",
  });
}

export function loadSupabaseSdkScript({
  document = globalThis.document,
  source = globalThis,
  url = SUPABASE_BROWSER_SDK_URL,
} = {}) {
  const existingFactory = getSupabaseCreateClient(source);
  if (existingFactory) return Promise.resolve(existingFactory);

  if (!document?.createElement || !document?.head?.append) {
    return Promise.reject(new Error("Supabase browser SDK requires a document."));
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.fastThirteenSupabaseSdk = SUPABASE_BROWSER_SDK_VERSION;
    script.referrerPolicy = "no-referrer";
    script.src = url;

    script.addEventListener("load", () => {
      const factory = getSupabaseCreateClient(source);
      if (factory) {
        resolve(factory);
      } else {
        reject(new Error("Supabase browser SDK loaded without createClient."));
      }
    }, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Supabase browser SDK request failed.")),
      { once: true },
    );

    document.head.append(script);
  });
}

export function createSupabaseSdkBootstrap({ loadSdk = loadSupabaseSdkScript } = {}) {
  let state = null;
  let pending = null;

  function prepare(config) {
    if (!state) state = config?.isConfigured ? loadingResult() : disabledResult();
    return state;
  }

  function current(config) {
    return state ?? prepare(config);
  }

  function load({ config, source = globalThis } = {}) {
    if (!config?.isConfigured) {
      state = disabledResult();
      return Promise.resolve(state);
    }

    if (state?.status === "ready") return Promise.resolve(state);
    if (pending) return pending;

    state = loadingResult();
    pending = Promise.resolve()
      .then(async () => {
        const existingFactory = getSupabaseCreateClient(source);
        const createClient = existingFactory ?? await loadSdk({ source });
        const result = createBrowserSupabaseClient({ config, createClient, source });

        if (result.status !== "ready") {
          throw result.error ?? new Error(result.message);
        }

        state = bootstrapResult({
          client: result.client,
          message: "Supabase browser SDK is ready for Google sign-in and read-only validation.",
          status: "ready",
        });
        return state;
      })
      .catch((error) => {
        state = failedResult(error);
        return state;
      })
      .finally(() => {
        pending = null;
      });

    return pending;
  }

  return {
    current,
    load,
    prepare,
  };
}

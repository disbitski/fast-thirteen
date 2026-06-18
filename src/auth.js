import { emptyData, normalizeProfile } from "./storage.js";

const DEFAULT_AUTH_MESSAGE = "Local tracking still works.";

export function authState({
  configured = false,
  error = null,
  message = null,
  session = null,
  status = "disabled",
  user = null,
} = {}) {
  return {
    configured,
    error,
    message,
    session,
    status,
    user,
  };
}

export function mapSupabaseSession(session) {
  const user = session?.user ?? null;

  return authState({
    configured: true,
    session: session ?? null,
    status: user?.id ? "authenticated" : "guest",
    user,
  });
}

export function mapAuthStateToProfile(authState, updatedAt = new Date().toISOString()) {
  if (authState?.status !== "authenticated" || !authState.user?.id) {
    return emptyData().profile;
  }

  const user = authState.user;
  const email = user.email ?? null;
  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    email?.split("@")[0] ??
    "Signed in";

  return normalizeProfile({
    mode: "authenticated",
    guestId: "local-guest",
    userId: user.id,
    email,
    displayName,
    provider: user.app_metadata?.provider ?? "google",
    updatedAt,
  });
}

export function readAuthCallbackState(searchParams = new URLSearchParams()) {
  const error = searchParams.get("error");
  const description = searchParams.get("error_description");
  const code = searchParams.get("error_code");
  const cancelled = error === "access_denied" || description?.toLowerCase().includes("cancel");

  if (!error && !description && !code) return null;

  return authState({
    configured: true,
    error: { code, description, error },
    message: cancelled
      ? "Google sign-in was cancelled. Local tracking still works."
      : description ?? "Google sign-in could not complete. Local tracking still works.",
    status: cancelled ? "cancelled" : "error",
  });
}

export function cleanAuthCallbackUrl(location = globalThis.location, history = globalThis.history) {
  if (!location?.search || !history?.replaceState) return;

  const params = new URLSearchParams(location.search);
  const authKeys = ["error", "error_code", "error_description"];
  if (!authKeys.some((key) => params.has(key))) return;

  for (const key of authKeys) params.delete(key);
  const query = params.toString();
  const nextUrl = `${location.pathname}${query ? `?${query}` : ""}${location.hash ?? ""}`;
  history.replaceState({}, "", nextUrl);
}

export function createAuthService({ clientStatus, config, createClient, supabaseClient } = {}) {
  let client = supabaseClient ?? null;

  function isConfigured() {
    return Boolean(config?.isConfigured);
  }

  function initialState(callbackState = null) {
    if (callbackState) return callbackState;
    if (!isConfigured()) {
      return authState({
        configured: false,
        message: "Google sign-in needs Supabase publishable config first.",
        status: "disabled",
      });
    }
    if (clientStatus && clientStatus !== "ready") {
      return authState({
        configured: true,
        message: "Supabase is configured, but the browser client is not loaded yet.",
        status: clientStatus,
      });
    }
    return authState({
      configured: true,
      message: "Checking Google sign-in status...",
      status: "loading",
    });
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (client) return client;
    if (typeof createClient === "function") {
      client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    }
    return client;
  }

  async function currentAuthState() {
    const authClient = getClient();
    if (!authClient?.auth?.getSession) {
      return initialState();
    }

    const { data, error } = await authClient.auth.getSession();
    if (error) {
      return authState({
        configured: true,
        error,
        message: error.message ?? DEFAULT_AUTH_MESSAGE,
        status: "error",
      });
    }

    return mapSupabaseSession(data?.session);
  }

  async function signInWithGoogle({ redirectTo } = {}) {
    if (!isConfigured()) {
      return {
        ok: false,
        status: "disabled",
        message: "Google sign-in needs Supabase publishable config first.",
      };
    }

    const authClient = getClient();
    if (!authClient?.auth?.signInWithOAuth) {
      return {
        ok: false,
        status: "not-ready",
        message: "Supabase is configured, but the browser client is not loaded yet.",
      };
    }

    const { data, error } = await authClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo ?? globalThis.location?.origin,
      },
    });

    if (error) {
      return {
        ok: false,
        status: "error",
        message: error.message ?? "Google sign-in could not start.",
        error,
      };
    }

    return {
      ok: true,
      status: "redirecting",
      data,
    };
  }

  async function signOut() {
    if (!isConfigured()) {
      return {
        ok: false,
        status: "disabled",
        message: "You are already using local-only tracking.",
      };
    }

    const authClient = getClient();
    if (!authClient?.auth?.signOut) {
      return {
        ok: false,
        status: "not-ready",
        message: "Sign-out is ready for Supabase, but the browser client is not loaded yet.",
      };
    }

    const { error } = await authClient.auth.signOut();
    if (error) {
      return {
        ok: false,
        status: "error",
        message: error.message ?? "Sign-out could not complete.",
        error,
      };
    }

    return {
      ok: true,
      status: "signed-out",
      message: "Signed out. Local fasting history remains on this device.",
    };
  }

  function onAuthStateChange(callback) {
    const authClient = getClient();
    if (!authClient?.auth?.onAuthStateChange) return null;

    const { data } = authClient.auth.onAuthStateChange((event, session) => {
      const state = mapSupabaseSession(session);
      callback({
        ...state,
        event,
        message:
          event === "SIGNED_OUT"
            ? "Signed out. Local fasting history remains on this device."
            : state.message,
        status: event === "SIGNED_OUT" ? "signed-out" : state.status,
      });
    });
    return data?.subscription ?? null;
  }

  return {
    currentAuthState,
    initialState,
    isConfigured,
    onAuthStateChange,
    signOut,
    signInWithGoogle,
  };
}

import { emptyData, normalizeProfile } from "./storage.js";

export function mapSupabaseSession(session) {
  const user = session?.user ?? null;

  return {
    status: user?.id ? "authenticated" : "guest",
    session: session ?? null,
    user,
  };
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

export function createAuthService({ config, createClient, supabaseClient } = {}) {
  let client = supabaseClient ?? null;

  function isConfigured() {
    return Boolean(config?.isConfigured);
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
      return { ...mapSupabaseSession(null), configured: isConfigured() };
    }

    const { data, error } = await authClient.auth.getSession();
    if (error) {
      return {
        ...mapSupabaseSession(null),
        configured: true,
        error,
      };
    }

    return {
      ...mapSupabaseSession(data?.session),
      configured: true,
    };
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

  return {
    currentAuthState,
    isConfigured,
    signInWithGoogle,
  };
}

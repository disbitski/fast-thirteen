export function getSupabaseCreateClient(source = globalThis) {
  return typeof source?.supabase?.createClient === "function"
    ? source.supabase.createClient.bind(source.supabase)
    : null;
}

export function createBrowserSupabaseClient({ config, source = globalThis, createClient } = {}) {
  if (!config?.isConfigured) {
    return {
      client: null,
      message: "Supabase config is missing.",
      status: "disabled",
    };
  }

  const factory = createClient ?? getSupabaseCreateClient(source);
  if (!factory) {
    return {
      client: null,
      message: "Supabase browser client is not loaded.",
      status: "not-ready",
    };
  }

  try {
    return {
      client: factory(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      }),
      message: null,
      status: "ready",
    };
  } catch (error) {
    return {
      client: null,
      error,
      message: error.message ?? "Supabase browser client could not start.",
      status: "error",
    };
  }
}

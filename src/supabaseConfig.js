export const CONFIG_GLOBAL = "__FAST_THIRTEEN_CONFIG__";

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanUrl(value) {
  const candidate = cleanString(value);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

function cleanPublishableKey(value) {
  const candidate = cleanString(value);
  if (!candidate) return null;

  const lower = candidate.toLowerCase();
  if (
    lower.startsWith("sb_secret_") ||
    lower.includes("service_role") ||
    lower.includes("private_key")
  ) {
    return null;
  }

  return candidate;
}

export function normalizeSupabaseConfig(value = {}) {
  const supabaseUrl = cleanUrl(value.supabaseUrl ?? value.SUPABASE_URL);
  const supabaseAnonKey = cleanPublishableKey(
    value.supabaseAnonKey ?? value.SUPABASE_ANON_KEY,
  );

  return {
    supabaseUrl,
    supabaseAnonKey,
    isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  };
}

export function loadSupabaseConfig(source = globalThis) {
  return normalizeSupabaseConfig(source?.[CONFIG_GLOBAL]);
}

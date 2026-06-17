import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/202606170001_create_profiles_and_fast_sessions.sql",
  "utf8",
);
const envExample = readFileSync(".env.example", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");
const docs = readFileSync("docs/supabase-foundation.md", "utf8");

test("supabase migration defines profile and session tables", () => {
  assert.match(migration, /create table if not exists public\.profiles/i);
  assert.match(migration, /create table if not exists public\.fast_sessions/i);
  assert.match(migration, /primary key \(user_id, id\)/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
});

test("supabase migration enforces row-level security by auth user", () => {
  assert.match(migration, /alter table public\.profiles enable row level security/i);
  assert.match(migration, /alter table public\.fast_sessions enable row level security/i);
  assert.match(migration, /auth\.uid\(\) = id/i);
  assert.match(migration, /auth\.uid\(\) = user_id/i);
});

test("supabase foundation keeps secrets out of committed config", () => {
  assert.match(envExample, /SUPABASE_URL=/);
  assert.match(envExample, /SUPABASE_ANON_KEY=/);
  assert.doesNotMatch(envExample, /SERVICE_ROLE/i);
  assert.doesNotMatch(envExample, /APPLE.*SECRET/i);
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(docs, /Service\s+role keys[\s\S]*must stay outside Git/i);
});

# Google OAuth Readiness

Fast Thirteen is still local-first. Google sign-in should only become active
after Supabase publishable config, the Supabase browser SDK, and Google
provider credentials are all ready. Missing auth setup must never block
starting, ending, editing, deleting, exporting, or importing fasts.

## Current App Contract

- Local-only tracking is the default.
- `/config.js` may expose the project URL, publishable key, default-off Google
  provider flag, and exact redirect-origin allowlist.
- The Google button stays hidden until Supabase publishable config exists and
  remains disabled until provider and redirect readiness are explicitly enabled.
- When config exists, the app loads the official Supabase browser client from
  jsDelivr at the exact version pinned in `src/supabaseSdkBootstrap.js`.
- The SDK is never requested without publishable config. Loading and failure
  states keep Guest mode, Local data, and every fasting action available.
- Google sign-in and cloud reads stay disabled until SDK bootstrap reports
  `ready`.
- SDK, provider, redirect, callback, and sign-in gates are shown separately in
  the profile/settings area.
- OAuth launch runs through a dedicated controller that requires the already
  computed readiness model, deduplicates repeated attempts, and reports
  loading, redirecting, cancelled, failed, or authenticated state.
- Supabase session and OAuth launch results are reduced to the identity and
  status needed by the app. Provider, access, and refresh tokens are neither
  exposed by the controller nor retained in Fast Thirteen auth state.
- The profile/settings area combines OAuth readiness with the existing
  read-only `fast_sessions` path in one deterministic validation report.
- Provider secrets, service-role keys, Apple signing keys, and generated client
  secrets must stay outside Git.

## Browser SDK Bootstrap

The static app does not commit a Supabase bundle or add an unconditional SDK
tag to `index.html`. `createSupabaseSdkBootstrap` requests the official v2
browser package only after `loadSupabaseConfig` finds both a valid project URL
and publishable key.

The package URL is pinned to `@supabase/supabase-js@2.105.3`. Update the
constant and its tests deliberately when upgrading; do not switch it to a
floating `@2` URL in application code.

Bootstrap states are local-safe:

- `disabled`: publishable config is missing and no SDK request is made.
- `loading`: one deduplicated SDK request is in progress.
- `ready`: one browser client is available for auth and read-only validation.
- `error`: the SDK or network failed; auth/cloud controls remain gated while
  local tracking continues.

The Supabase JavaScript installation guide documents browser CDN loading, and
the app uses the same official package distribution with an exact version pin:
<https://supabase.com/docs/reference/javascript/installing>.

## Supabase Dashboard Setup

1. Create or open the Supabase project for Fast Thirteen.
2. Confirm the database migration in `supabase/migrations/` has been applied.
3. In Auth provider settings, enable Google.
4. Paste the Google OAuth Client ID and Client Secret into the Supabase Google
   provider settings.
5. Keep the Client Secret in Supabase or local secret storage only. It does not
   belong in `.env.example`, `/config.js`, browser code, tests, docs examples,
   or committed scripts.
6. In Auth URL Configuration, add each full Fast Thirteen return URL to the
   Redirect URLs list:
   - `http://127.0.0.1:4173/`
   - `http://192.168.86.50:4173/`
   - `https://disbitski.github.io/fast-thirteen/`

These application return URLs are distinct from Google's authorized redirect
URI. Fast Thirteen passes one of them to Supabase as `redirectTo`; Supabase then
returns the browser there after Google authentication. The app's public
redirect-origin allowlist is an extra client-side gate and does not replace the
Supabase Redirect URLs list.

Supabase's Google provider guide says Google setup needs a Cloud project,
configured audience, scopes, branding, and a Web application OAuth client.
Supabase requires the basic identity scopes: `openid`, user email, and user
profile. Extra sensitive scopes should be avoided unless the app truly needs
them.

## Google Cloud Setup

Create an OAuth client in Google Auth Platform:

1. Choose application type `Web application`.
2. Add Authorized JavaScript origins for the app origins:
   - Local testing on this Mac: `http://127.0.0.1:4173`
   - LAN testing if needed: `http://192.168.86.50:4173`
   - Future hosted production origin, for example `https://fast-thirteen.example.com`
3. Add the Supabase callback URL under Authorized redirect URIs:
   - Hosted Supabase project: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Supabase local development, if used later: `http://127.0.0.1:54321/auth/v1/callback`
4. Save the Client ID and Client Secret.
5. Put those values into Supabase's Google provider settings, not into this
   repository.

Google's OAuth docs describe redirect URIs as the endpoints where Google's
OAuth server sends responses, and those URIs must match Google's validation
rules. Supabase's Google guide specifically calls for adding the Supabase
project callback URL as the Google authorized redirect URI.

## Local Environment

For the current local server, `.env` may contain:

```sh
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-anon-key>
SUPABASE_GOOGLE_PROVIDER_ENABLED=false
SUPABASE_AUTH_REDIRECT_ORIGINS=http://127.0.0.1:4173,http://192.168.86.50:4173,https://disbitski.github.io
SUPABASE_PROJECT_ID=<project-ref>
```

Do not commit `.env`. The committed `.env.example` remains blank on purpose.

Start `npm start` from the shell that exports these values. The server emits
only these browser-publishable values through `/config.js`. Opening the static
GitHub Pages demo without config must remain in Guest mode, make no SDK request,
and expose no project-specific values.

`SUPABASE_GOOGLE_PROVIDER_ENABLED` is browser-publishable confirmation that the
Google provider has been configured in Supabase; it is not a credential. Keep
it `false` until the throwaway provider setup is complete. Redirect origins are
exact matches: scheme, hostname, and port must all match the current page.
Paths do not belong in this origin list. Fast Thirteen derives the full return
URL separately, preserving `/fast-thirteen/` on GitHub Pages.

The five readiness stages mean:

- `SDK`: the pinned browser client loaded.
- `Provider`: explicit public provider readiness is enabled.
- `Redirect`: the current page origin is in the exact allowlist.
- `Callback`: no cancellation or callback error is hiding from the user.
- `Sign in`: every non-secret preflight passed and the button may call OAuth.

Cancellation and callback errors remain visible but do not touch local fasting
data. That feedback survives Supabase's initial guest-session hydration instead
of disappearing immediately. When all configuration gates still pass, the
user may retry sign-in.

## OAuth Launch Controller

`src/googleOAuthController.js` is the only UI launch path for Google OAuth. It
accepts a precomputed `createGoogleOAuthReadiness` result and rejects the launch
before calling Supabase unless `canSignIn` and `redirectTo` are both present.
The auth service repeats the same checks as a second boundary.

The controller:

- shares one in-flight launch for repeated clicks to the same redirect;
- keeps Local data available in every state;
- turns callback cancellation and errors into retryable user feedback;
- yields to a real authenticated event or explicit sign-out;
- never returns raw Supabase OAuth response data to the UI; and
- never stores provider, access, or refresh tokens.

An accepted launch changes only controller state. It does not migrate guest
history, apply cloud rows, write `fast_sessions`, or mark local metadata as
synced.

## Read-Only Validation Report

`src/oauthValidationReport.js` combines nine checks for a configured
throwaway profile:

1. pinned browser SDK readiness;
2. explicit Google provider readiness;
3. exact redirect-origin readiness;
4. authenticated callback state;
5. token-free authenticated session health;
6. the read-only `fast_sessions` repository and RLS result;
7. stable-id merge preview and invalid-row result;
8. the disabled local-apply gate; and
9. the disabled cloud-write gate.

The report exposes aggregate local, cloud, duplicate, and invalid-row counts,
not raw session rows. A passed report proves only that OAuth and read planning
worked for the test profile. Local apply, upload, update, tombstone,
confirmation, finalization, and Apple login remain disabled.

`src/authProfileCoordinator.js` supplies the report and pull controller with a
generation-scoped profile identity. It invalidates pending and completed cloud
preview state when the authenticated user changes, signs out, expires, or hits
an auth refresh failure. Re-entering the same account after sign-out receives a
new generation. This prevents old rows or aggregate counts from crossing an
auth lifecycle even when an older network response completes late.

The coordinator and report retain no provider, access, or refresh tokens.
Callback cancellation remains visible in Guest mode without creating an
authenticated profile scope.

## Session Health And Recovery

`src/authSessionHealth.js` normalizes `INITIAL_SESSION`, `SIGNED_IN`,
`TOKEN_REFRESHED`, `USER_UPDATED`, and `SIGNED_OUT` into a small token-free
health model. Session checks can also report `checking`, `expired`,
`refresh-failed`, and `local-fallback` without retaining the Supabase session,
user id, provider token, access token, or refresh token.

The profile/settings card shows the current health label, last local session
check and its initial/manual/resume/reconnect source, recovery guidance, and
whether a previous profile preview was reset. Its manual action and the
cooldown-gated visible-resume/online-reconnect coordinator call only
`auth.getSession()` through `currentAuthState()`. They do not launch OAuth,
query `fast_sessions`, apply cloud rows, mutate fasting history, or update local
sync metadata. Hidden, offline, disabled, duplicate, and rapid repeat signals
are ignored.

Repeated checks share one in-flight request. A sign-out, expiry, auth event, or
profile generation change makes an older completion stale. Successful
`TOKEN_REFRESHED` and `USER_UPDATED` events for the same user keep the current
profile generation, while a different user starts a new isolated generation.
Profile persistence is separate from fasting sync metadata, so auth recovery
cannot mark Local data synced or change its last-sync timestamp.

## Token-Free Session Freshness

Supabase session hydration may include `expires_at` as Unix seconds.
`mapSupabaseSession` converts only that value to an ISO timestamp and continues
to omit provider, access, and refresh tokens. `src/authSessionFreshness.js`
uses the timestamp to model healthy, expiring, expired, checking, unknown, and
local-fallback states with an injected clock.

One lifecycle-scoped timer updates the UI at the warning boundary and performs
one auth-only recheck at expiry. It reuses `currentAuthState()` and the existing
session-health controller, so request deduplication and stale-profile isolation
still apply. A same-user token refresh reschedules the timer without changing
the profile generation. Hidden, offline, disabled, signed-out, failed-refresh,
and changed-profile states cancel or suppress it. No expiry path can query
fasting rows, launch OAuth, mutate Local data, update sync metadata, or enable
cloud writes.

If Supabase local development is used later, store the Google secret outside
Git and reference it from local Supabase config, for example:

```sh
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<google-client-secret>
```

## Production Prerequisites

Before real production login:

- Choose a stable HTTPS deployment URL.
- Add that URL to Supabase Site URL and redirect allow-list settings.
- Add the production origin to Google Authorized JavaScript origins.
- Keep the Supabase callback URL in Google Authorized redirect URIs.
- Confirm the consent screen branding and app name are recognizable.
- Confirm RLS is enabled before any cloud sync writes user data.
- Run through guest data export before first real migration testing.

## Apple Login Boundary

Apple login is intentionally deferred until Google works end to end. Apple adds
Services ID setup, signing key handling, generated client-secret rotation, and
first-login name capture. None of that belongs in this milestone.

## References

- [Supabase Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)

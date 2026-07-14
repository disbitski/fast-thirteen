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
data. When all configuration gates still pass, the user may retry sign-in.

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

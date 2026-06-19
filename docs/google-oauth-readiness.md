# Google OAuth Readiness

Fast Thirteen is still local-first. Google sign-in should only become active
after Supabase publishable config, the Supabase browser SDK, and Google
provider credentials are all ready. Missing auth setup must never block
starting, ending, editing, deleting, exporting, or importing fasts.

## Current App Contract

- Local-only tracking is the default.
- `/config.js` may expose only `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- The Google button stays hidden until Supabase publishable config exists.
- If config exists but the browser SDK is missing, the app reports `SDK missing`
  instead of attempting OAuth.
- Provider secrets, service-role keys, Apple signing keys, and generated client
  secrets must stay outside Git.

## Supabase Dashboard Setup

1. Create or open the Supabase project for Fast Thirteen.
2. Confirm the database migration in `supabase/migrations/` has been applied.
3. In Auth provider settings, enable Google.
4. Paste the Google OAuth Client ID and Client Secret into the Supabase Google
   provider settings.
5. Keep the Client Secret in Supabase or local secret storage only. It does not
   belong in `.env.example`, `/config.js`, browser code, tests, docs examples,
   or committed scripts.

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
SUPABASE_PROJECT_ID=<project-ref>
```

Do not commit `.env`. The committed `.env.example` remains blank on purpose.

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
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)

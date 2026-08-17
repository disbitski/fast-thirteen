# Cloudflare Sync

Fast Thirteen uses a dedicated Cloudflare Worker and D1 database for the
personal cross-device beta. The web, iPhone, Mac, and Apple Watch clients all
keep an offline copy and synchronize the same versioned snapshot through:

`https://fast-api.thedavedev.com/v1/data`

The API is separate from the podcast Worker and database. A private, randomly
generated sync key protects the personal endpoint. The key is a Cloudflare
Worker secret, is never committed to Git, and is stored in Keychain by the
native apps. The web client stores it only in that browser after it is entered
on the Settings page.

## Cloudflare Resources

- Worker: `fast-thirteen-api`
- Custom domain: `fast-api.thedavedev.com`
- D1 database: `fast-thirteen`
- D1 binding: `DB`
- Worker secret: `SYNC_TOKEN`

The Worker source and D1 schema live in [`cloudflare/`](../cloudflare/).
Cloudflare's current free allowances are much larger than a personal tracker's
expected traffic: 100,000 Worker requests per day, 5 million D1 rows read per
day, 100,000 rows written per day, and 5 GB of D1 storage.

## Deployment

After authenticating Wrangler:

```sh
wrangler d1 create fast-thirteen
wrangler d1 execute fast-thirteen --remote --file cloudflare/schema.sql
wrangler secret put SYNC_TOKEN --config cloudflare/wrangler.toml
wrangler deploy --config cloudflare/wrangler.toml
```

Patch the returned D1 database ID into `cloudflare/wrangler.toml` before the
schema and deploy commands. Do not place the sync key in `wrangler.toml`, an
environment example, the Xcode project, or browser JavaScript.

## Data Safety

The API validates every session before storing a snapshot. Sessions merge by
stable ID, the newest `updatedAt` wins, and a deletion tombstone wins timestamp
ties. D1 writes use a revision check and retry to avoid silently losing a
concurrent update.

Before the first upload, keep a JSON export and the existing Mac Tower data
file. The first cloud migration sends the existing versioned snapshot without
changing those local copies.

## Public Product Follow-Up

The private sync key is intentionally scoped to the current single-person
beta. Before Fast Thirteen becomes a public multi-user service, replace it with
Google and Apple account authentication and derive D1 ownership from the
verified user identity.

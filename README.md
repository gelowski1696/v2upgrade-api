# POSV2 Subscription API

NestJS API for subscriptions, registered POS devices, owner portal accounts, and read-only store snapshot reporting.

## Stack

- NestJS 11
- Prisma ORM 7.9 with the PostgreSQL driver adapter
- A separate generated Prisma client with the read-only SQLite driver adapter
- PostgreSQL 15 or newer
- JWT access tokens and rotating opaque refresh tokens
- Argon2id password hashing
- Swagger/OpenAPI at `/docs`

Prisma is isolated in `src/infrastructure`. Domain and application code do not import generated database models.

## Requirements

- Node.js 22
- PostgreSQL running locally or on a reachable server
- An empty PostgreSQL database named `posv2_subscription`, or another name configured in `DATABASE_URL`

## Configure

Copy `.env.example` to `.env` and replace every placeholder:

```powershell
Copy-Item .env.example .env
```

Generate strong JWT secrets. Do not reuse the access and refresh secrets.

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

## Database

Generate the typed client after schema changes:

```powershell
npm run db:generate
npm run db:generate:store
```

Apply migrations during local development:

```powershell
npm run db:migrate
```

Apply committed migrations in a deployed environment:

```powershell
npm run db:deploy
```

Schema synchronization is not used. Database changes must be committed as migrations.

## First Administrator

After migrating the database, create the first administrator:

```powershell
npm run admin:create -- adminvmjam "replace-with-a-strong-password" "System Administrator"
```

The command refuses passwords shorter than 12 characters and never creates a default account automatically.

## Run

```powershell
npm run start:dev
```

- API: `http://localhost:3100/api/v1`
- Swagger: `http://localhost:3100/docs`
- Health: `http://localhost:3100/api/v1/health`

The API stores uploaded database snapshots below `STORE_SNAPSHOT_ROOT`. In production, place this directory on persistent storage available only to the API service account. Back up this directory together with PostgreSQL metadata.

The owner dashboard origin must be present in `CORS_ORIGINS`. HTTPS is required outside local development.

## Implemented Endpoints

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

GET    /api/v1/clients
POST   /api/v1/clients
GET    /api/v1/clients/:id
PATCH  /api/v1/clients/:id
POST   /api/v1/clients/:id/archive

GET    /api/v1/plans
POST   /api/v1/plans
GET    /api/v1/plans/:id
POST   /api/v1/plans/:id/versions
POST   /api/v1/plans/:id/versions/:versionId/publish
POST   /api/v1/plans/:id/archive

GET    /api/v1/subscriptions
POST   /api/v1/subscriptions
GET    /api/v1/subscriptions/:id
GET    /api/v1/subscriptions/:id/events
POST   /api/v1/subscriptions/:id/activate
POST   /api/v1/subscriptions/:id/suspend
POST   /api/v1/subscriptions/:id/reactivate
POST   /api/v1/subscriptions/:id/cancel
POST   /api/v1/subscriptions/:id/renew

POST   /api/v1/licenses/validate

POST   /api/v1/device-sync/sessions
PUT    /api/v1/device-sync/sessions/:id/file
POST   /api/v1/device-sync/sessions/:id/complete
GET    /api/v1/device-sync/status
GET    /api/v1/device-sync/snapshots
POST   /api/v1/device-sync/snapshots/:snapshotId/reactivate

POST   /api/v1/device-portal/invitations
GET    /api/v1/device-portal/users
POST   /api/v1/device-portal/users/:id/disable
POST   /api/v1/device-portal/users/:id/enable
POST   /api/v1/device-portal/users/:id/password-reset
POST   /api/v1/device-portal/invitations/:id/revoke

POST   /api/v1/portal/auth/activate
POST   /api/v1/portal/auth/login
POST   /api/v1/portal/auth/refresh
POST   /api/v1/portal/auth/logout
POST   /api/v1/portal/auth/reset-password
POST   /api/v1/portal/auth/change-password
GET    /api/v1/portal/auth/sessions
DELETE /api/v1/portal/auth/sessions/:sessionId
POST   /api/v1/portal/auth/sessions/revoke-others
GET    /api/v1/portal/stores
GET    /api/v1/portal/activity
GET    /api/v1/portal/preferences
PUT    /api/v1/portal/preferences/overview
POST   /api/v1/portal/preferences/saved-views
DELETE /api/v1/portal/preferences/saved-views/:viewId
DELETE /api/v1/portal/preferences
GET    /api/v1/portal/stores/:storeId/overview
GET    /api/v1/portal/stores/:storeId/sales
GET    /api/v1/portal/stores/:storeId/inventory
GET    /api/v1/portal/stores/:storeId/inventory-forecast
GET    /api/v1/portal/stores/:storeId/profitability
GET    /api/v1/portal/stores/:storeId/customer-insights
GET    /api/v1/portal/stores/:storeId/customers/:customerId/purchase-history
GET    /api/v1/portal/stores/:storeId/sales-targets
POST   /api/v1/portal/stores/:storeId/sales-targets
GET    /api/v1/portal/stores/:storeId/transfers
GET    /api/v1/portal/stores/:storeId/customer-balances
GET    /api/v1/portal/stores/:storeId/cash-flow
GET    /api/v1/portal/stores/:storeId/exports/inventory-forecast
GET    /api/v1/portal/stores/:storeId/exports/profitability
GET    /api/v1/portal/stores/:storeId/exports/customer-insights
```

The inventory forecast uses the requested `from` and `to` dates as its sales-history sample. It
accepts `forecastDays=7|14|30`, plus optional `search`, `category`, and `risk` filters. Forecast and
CSV endpoints are read-only and enforce the same portal store authorization as the inventory report.

Profitability accepts the normal date range and paging parameters, optional `search` and `category`
filters, and `profitabilitySort=PROFIT|MARGIN|REVENUE`. It ranks synchronized sold-item lines, shows
recorded-cost coverage, and compares the requested range with the immediately preceding equal-length
period. Missing costs remain visible and are treated as zero, matching the existing POS calculation.

Customer insights accepts the normal date range and paging parameters, optional `search`, and
`customerSort=SPEND|VISITS|RECENT|BALANCE`. It includes active registered customers with
non-cancelled sales in the selected period. Purchase history uses the same date scope, and both
customer endpoints enforce portal store authorization. The matching CSV export is read-only.

Sales targets accept a `YYYY-MM` month and compare portal metadata targets with the existing
non-cancelled sales and recorded-gross-profit calculations. Owners and managers may update target
values; viewers receive the same progress report without edit permission. Run `npm run db:deploy`
before enabling the feature in an environment that predates the sales-target migration.

Dashboard preferences store ordered Overview metrics and named report views in account-scoped
PostgreSQL metadata. Saved-view input accepts only supported reports, date presets, and whitelisted
filters, and its store must belong to the signed-in portal account. The reset endpoint removes all
saved views and restores the default metric order. Run `npm run db:deploy` before enabling this
feature in an environment that predates the dashboard-preferences migration.

Portal activity is read from the existing platform audit ledger and accepts `from`, `to`, optional
`action`, optional authorized `storeId`, `page`, and `pageSize`. Only allowlisted owner-facing events
are returned. Raw metadata—including tokens, IP addresses, checksums, paths, request payloads, and
internal errors—is never included in the response. Backup and restore scripts record only their
operation type and pass/fail status in the audit ledger.

All client, plan, and subscription endpoints require a bearer access token. Mutation permissions are also enforced by API roles.

## Verification

```powershell
npm run build
npm test
npm run lint
```

With the local API running and a development subscription device registered, verify the complete real-database owner flow with:

```powershell
npm run verify:owner-sync
```

The verifier creates a consistent temporary snapshot, uploads and activates it, activates a temporary owner account, compares dashboard totals with the same snapshot, disables the temporary account, and removes the temporary file. If the desktop development configuration generated a new device ID, rebind the single local development subscription first with `npm run dev:rebind-pos-device`.

To exercise synchronization isolation and recovery with 30 temporary stores and 30 distinct SQLite databases:

```powershell
npm run test:sync:30
```

The load test uses five concurrent workers by default, verifies all active snapshots, tests the active-plus-two retention policy and rollback endpoint, and removes its PostgreSQL records, snapshot folders, and temporary databases in a `finally` cleanup. Set `SYNC_TEST_CONCURRENCY` to change the worker count.

To verify tenant isolation and rejected-upload safety against the live API:

```powershell
npm run test:sync:security
```

This harness provisions two isolated clients and validates device, portal, upload-session, and snapshot boundaries. It also exercises tampered credentials, malformed IDs, incompatible schemas, oversized declarations, corrupt databases, checksum and size mismatches, duplicate uploads, cancellation, and a missing active snapshot file. Every rejected operation must leave the previous active snapshot unchanged. Test identities and files are removed automatically.

To run repeated concurrent synchronization cycles with intentional connection interruptions and retry verification:

```powershell
npm run test:sync:soak
```

The default soak provisions 12 isolated tenants, performs 8 revisions per store with 6 concurrent workers, interrupts every fourth upload, and confirms active-snapshot hashes after each cycle. It also verifies active-plus-two retention, removes interrupted staging files, detects dangling sessions, and cleans all temporary records and files. Increase the workload with `SYNC_SOAK_STORES`, `SYNC_SOAK_CYCLES`, `SYNC_SOAK_CONCURRENCY`, `SYNC_SOAK_INTERRUPT_EVERY`, and `SYNC_SOAK_PAYLOAD_KB`.

Database E2E tests will use a separate `posv2_subscription_test` connection once its credentials are configured. Never point test commands at development or production data.

## Backup And Recovery

Create one coordinated daily backup containing PostgreSQL metadata and every active or retained store snapshot:

```powershell
npm run backup:platform
```

The same date is replaced by a complete new backup. `PLATFORM_BACKUP_RETAIN_DAYS` controls dated-folder retention and defaults to 30 days. Run an isolated restore drill at any time:

```powershell
npm run backup:restore-drill
```

The drill restores PostgreSQL into a temporary database, verifies metadata counts and snapshot hashes, recomputes active-store dashboard totals, and then removes the temporary database. It never writes to the live database or snapshot directory.

Both backup commands record their latest running, passed, or failed result in
`PLATFORM_BACKUP_ROOT/health.json`. The owner portal reads this operational record and displays a
high-severity alert when the latest platform backup or restore drill failed. An operation that stays
in the running state for more than six hours is reported as incomplete. Detailed server errors remain
in the health record and server logs; they are not returned to portal users.

Register the backup as a daily Windows task at 2:00 AM, or pass a different time directly to the script:

```powershell
npm run backup:schedule:windows
powershell -ExecutionPolicy Bypass -File scripts/register-windows-backup-task.ps1 -Time 23:30
```

## Scheduled Owner Reports

The owner portal can deliver daily and weekly store summaries at 07:00 in each store's configured
timezone. Verify a sending domain in Resend, create a sending-only API key restricted to that domain,
and configure:

```dotenv
PORTAL_SCHEDULED_REPORTS_ENABLED=true
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL=VMJAM Reports <reports@example.com>
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxx
```

Scheduled email reports are disabled by default. Set
`PORTAL_SCHEDULED_REPORTS_ENABLED=false` (or omit it) to stop the in-process worker and prevent
delivery retries while keeping the rest of the API and owner portal available.

The portal sends a six-digit verification code to the signed-in account's username, which must be a
valid email address. A schedule cannot be enabled until that exact address is verified. Summary email
and CSV content includes the store, report period, snapshot age, and data-quality status. Snapshots at
least 24 hours old are delivered only with a visible stale-data warning.

The in-process worker checks due schedules once per minute. Each schedule and report period is unique,
an account can enable at most 10 schedules, and delivery attempts are capped at 10 per account per
hour. Failed delivery is retried after 5 minutes and 30 minutes, then remains failed for review. Every
attempt is recorded in portal metadata; synchronized POS records are never changed.

Each API request uses the delivery record ID as its Resend idempotency key and stores the returned
Resend email ID. Configure the Resend webhook URL as
`https://your-api.example.com/api/v1/webhooks/resend` for `email.sent`, `email.delivered`,
`email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and
`email.suppressed`. Signed webhook events update the delivery history with the provider-confirmed
outcome; unsigned or invalid webhook requests are rejected.

## Architecture

```text
src/
|-- domain/          Framework-independent contracts and rules
|-- application/     Use-case services
|-- infrastructure/  Prisma, PostgreSQL, hashing, and JWT adapters
|-- presentation/    HTTP controllers, DTOs, guards, and filters
`-- modules/         Nest dependency wiring
```

Dependency direction is `presentation -> application -> domain`; infrastructure implements domain ports and is bound only in Nest modules.

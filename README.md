# RV Dealer Backend

This project is a dealership-grade REST API for RV inventory, CRM, content, marketing, and operations. It mirrors the Sewell Motorcoach WordPress backend while using modern Node/Express patterns, security middleware, and file-backed persistence for fast local demos. Everything a developer needs—from architecture, configuration, and endpoints to seed data, scripts, and observability—is documented here.

## Architecture at a glance
- **Express-style server.** A lightweight router (`src/lib/miniExpress`) powers `index.js` with middleware for CORS, gzip, request parsing, static assets, and error handling. Request lifecycle: inbound request → tenant resolution (`tenantService`) → auth/role guard → validation → handler → persistence → audit/logging → response.
- **File-backed persistence.** All resources are stored under `data/` and loaded via `src/persistence/store.js`. CRUD writes back to disk and appends to `data/audit.log` with masked PII; snapshots are packaged under `/v1/exports/snapshot` for per-tenant restore/testing.
- **Validation-first.** Central schemas live in `src/validation/schemas.js` and are enforced with `validateBody`, `validateParams`, and `validateQuery` middleware. Each route declares its schema so adding endpoints stays declarative.
- **Security & resilience.** Rate limiting, login backoff, CSRF cookies/headers, sanitization, HSTS/HTTPS enforcement, structured errors, and gzip are built-in (`index.js`). Error responses follow `{ code, message, details? }` so the UI and tests can assert on machine-readable codes.
- **Multi-tenant by default.** `tenantService` initializes tenants and ensures every request is scoped by `X-Tenant-Id` (default `main`). Exports, audit logs, and metrics are tenant-aware.
- **AI-capable surface.** Providers, observations, assistant sessions, and optional remote web fetches (`AI_WEB_FETCH`) are first-class features (`src/services/aiService.js`, `src/services/aiAssistantService.js`). AI events are also audit-logged with PII masking.

### Server & middleware pipeline (from `index.js`)
- **Custom Express clone.** `src/lib/miniExpress` implements routing, middleware stacks, helpers (`res.json`, `res.cookie`, `res.sendFile`), static file serving, and JSON/urlencoded body parsing with size enforcement.
- **Core middleware:** gzip (when enabled), security headers, JSON/urlencoded parsers, cookie parsing, and CORS (`origin: true`, credentials allowed). Static files in `/public` are served alongside the API.
- **Input hygiene:** request strings/arrays/objects are recursively sanitized before routing logic executes.
- **Request context:** every request gets a `X-Request-Id`, structured logs, and per-route metrics (count/status/latency) for `/metrics`.
- **Tenant resolution:** `tenantService.resolveTenantId` normalizes tenant IDs and ensures the tenant exists before any business logic runs.
- **Transport security:** optional HTTPS enforcement plus HSTS when behind a TLS-terminating proxy.
- **Abuse protection:** sliding-window rate limiting (defaults in config) plus exponential login backoff keyed by IP.
- **State protections:** CSRF token issue/check middleware, auth guards (JWT or API key), role authorization, and centralized error handling wrapping all routes.

### Request lifecycle (deep dive)
1. **Inbound HTTP** hits `index.js`, which wires CORS, compression, JSON/body parsers (size-limited), and static file hosting for `/public`.
2. **Tenant resolution** via `tenantService.requireTenant` ensures `req.context.tenantId` exists (header `X-Tenant-Id` or payload `tenantId`) and creates isolated data stores on-demand.
3. **Authentication** – `authMiddleware` validates bearer JWTs or static API keys and decorates `req.context.user` with role + username. Login/refresh routes skip guards by design.
4. **Rate limiting/backoff** – global limiter and login-specific backoff prevent brute force. Violations emit `RATE_LIMITED` errors.
5. **Validation** – route-level middleware loads schemas from `src/validation/schemas.js`; failures respond with `VALIDATION_ERROR` and `details.path` for UI highlighting.
6. **Business logic** – handlers in `src/routes/*.js` call `src/services/*.js` to perform domain work. Services orchestrate persistence through `store.js` to keep audit hooks consistent.
7. **Persistence + audit** – writes flush to `data/*.json` and append structured entries to `data/audit.log`, redacting fields in `PII_MASK_FIELDS`.
8. **Response shaping** – successful handlers return JSON; errors travel through centralized error middleware which maps codes → HTTP status, and emits structured logs.

### Project structure (high-signal entry points)
- `index.js` – server bootstrap, middleware wiring, route registration, and health/metrics.
- `src/routes/*.js` – resource routers grouped by domain (inventory, content, auth, ai, analytics, exports, etc.).
- `src/services/*.js` – business logic for auth, tenants, analytics, inventory, AI, and imports.
- `src/lib/miniExpress` – tiny Express-like router and middleware composition helpers.
- `src/persistence/store.js` – typed JSON persistence helpers with audit tap-ins and soft-failure guards.
- `src/validation/schemas.js` – shared request/response schemas consumed by route validators.
- `data/` – JSON fixtures for all resources plus `audit.log` for traceability (per-tenant entries).
- `scripts/` – operational utilities (backfill inventory, etc.).
- `test/` – Node test runner suites that exercise routing, validation, and auth flows.

### Service map (what lives where)
- **Auth & security:** `authService.js` (JWT issuance/verification, refresh rotation/revocation), `jwt.js` (token helpers), `security.js` (masking), `tenantService.js`/`tenancy.js` (normalization, scoping), `state.js` (data hydration/persistence helpers), middleware under `src/middleware` (validation, CSRF, errors).
- **Inventory:** `inventoryService.js` (CRUD/search/stats/story updates), `inventoryRevisionService.js` (revision history + restores), `inventorySchemaService.js` (per-unit schema view), `inventoryBadges.js` (badge calculation), `spotlightTemplateService.js` (feature templates).
- **Content & layout:** `contentPageService.js` (pages), `pageLayoutService.js` (draft/publish), `blockPresetService.js` (builder presets), `redirectService.js` (SEO redirects), `seoService.js` (profiles/autofill), `experimentService.js` (A/B definitions).
- **CRM & ops:** `leadService.js` (lead intake/timeline), `leadScoringService.js`, `leadEngagementService.js`, `customerService.js`, `taskService.js`, `notificationService.js`, `serviceTicketService.js`, `eventService.js` (operational events), `campaignService.js` (campaign CRUD + reporting), `financeOfferService.js`.
- **People & reputation:** `teamService.js` (staff directory), `reviewService.js` (testimonial workflows).
- **Analytics & observability:** `analyticsService.js` (event capture + dashboard), `capabilityService.js` (100-point checklist + status), `auditLogService.js` (audit reader), `exportService.js` (tenant snapshots), `webhookService.js` (webhook + deliveries), `settingsService.js` (tenant settings), `state.js` (per-tenant datasets and persistence mapping).
- **AI:** `aiService.js` (providers, observations, web fetch orchestration), `aiAssistantService.js` (assistant sessions/messages/tool calls), `shared.js` (utility functions for sanitization/helpers).

### Data directory map
- `data/users.json` – seeded users + roles; referenced by auth service.
- `data/inventory.json` – primary unit catalog plus `revisions` arrays for storytelling/history.
- `data/content.json`, `data/pages.json`, `data/campaigns.json`, `data/leads.json`, `data/customers.json`, etc. – domain objects for the demo tenant.
- `data/audit.log` – append-only audit trail including tenant, user, action, resource, before/after snapshots with masked PII.
- `data/exports/` – generated snapshot archives per tenant when calling `/v1/exports/snapshot`.

#### Full fixture list (per-tenant where applicable)
`aiControl.json` (providers, agents, observations, assistant sessions, web fetches, automation plans), `analytics.json`, `capabilities.json`, `contentPages.json`, `inventory.json`, `inventoryRevisions.json`, `teams.json`, `reviews.json`, `leads.json`, `customers.json`, `serviceTickets.json`, `financeOffers.json`, `settings.json`, `tenants.json`, `users.json`, `refreshTokens.json`, `revokedRefreshTokens.json`, `seoProfiles.json`, `pageLayouts.json`, `webhooks.json`, `webhookDeliveries.json`, `redirects.json`, `spotlightTemplates.json`, `blockPresets.json`, `experiments.json`, `tasks.json`, `notifications.json`, `campaigns.json`, plus `events.json` for operational events. All load through `src/services/state.js` using `src/persistence/store.js` and are normalized with tenant metadata on boot.

## Getting started
1. **Install Node.js** (v18+ recommended) and dependencies:
   ```sh
   npm install
   ```
2. **Configure secrets.** Copy `.env.example` to `.env` and set values (see configuration reference). All defaults live in `src/config.js`.
3. **Start the API.**
   ```sh
   npm start      # production-style
   npm run dev    # same command, preserved for symmetry
   ```
4. **Run tests.** Uses Node’s built-in runner:
   ```sh
   npm test
   ```
5. **Access endpoints.** Both `/` and `/v1` are served. Example:
   ```sh
   curl http://localhost:3000/v1/inventory \
     -H "X-Tenant-Id: main" \
     -H "Authorization: Bearer <accessToken>"
   ```

### Local data and reset patterns
- **Seeded JSON files** live under `data/`. Delete a file to regenerate default fixtures on next boot. Keep `audit.log` if you need request trails for debugging.
- **Per-tenant isolation** is enforced in the persistence layer; fixtures initialize with a single `main` tenant but the APIs will create a new namespace automatically when requests include a new `X-Tenant-Id`.
- **Idempotent imports** – re-running CSV imports updates matching `stockNumber` rows; the audit log records changed fields.

## Configuration reference (from `src/config.js`)
- **Server:** `PORT` (default `3000`), `ENFORCE_HTTPS`, `HSTS_MAX_AGE_SECONDS`, `JSON_BODY_LIMIT_MB`, `COMPRESSION_ENABLED`.
- **Auth:** `JWT_SECRET`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`, `API_KEY` (optional static bearer), `PASSWORD_SALT`.
- **Rate limiting & safety:** `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `CSRF_ENABLED`, `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME`, `CSRF_PROTECTED_METHODS`.
- **Tenancy:** `DEFAULT_TENANT_ID` fallback when `X-Tenant-Id` is omitted.
- **AI & privacy:** `AI_WEB_FETCH`, `AI_FETCH_TIMEOUT_MS`, `PII_MASK_FIELDS` for audit redaction.
- **Persistence:** `DATA_DIR` (env var read by `src/persistence/store.js`) points to the folder containing JSON fixtures and audit log.

### Operational defaults
- **Rate limits:** default window 1 minute with a low ceiling for demos; adjust upward for load tests.
- **Token TTLs:** access tokens are intentionally short (minutes) and refresh tokens longer (hours) to encourage rotation; both are per-tenant.
- **CSRF:** enabled for mutating verbs when `CSRF_ENABLED=true` and automatically issues a `csrfToken` cookie + header on first contact.
- **Audit log:** every mutating request appends `{ timestamp, tenantId, user, action, resource, before?, after? }` with fields from `PII_MASK_FIELDS` redacted.
- **Static API key:** when `API_KEY` is set, clients may send `Authorization: Bearer <API_KEY>` for service-to-service use cases (still tenant-scoped).

### Configuration tips
- Use `.env` locally; production deployments should source secrets from a vault/secret manager. `src/config.js` already reads env vars with safe defaults.
- For HTTPS termination in containers/behind proxies set `ENFORCE_HTTPS=true` and configure `trust proxy` in your upstream (nginx, load balancer) so redirects work.
- Increase `JSON_BODY_LIMIT_MB` when uploading large embedded JSON (e.g., specs) but keep gzip enabled to protect bandwidth.
- Tune `AI_FETCH_TIMEOUT_MS` when remote web fetch is on to avoid tying up worker threads during long scrapes.

## Seed data, roles, and authentication
- Users live in `data/users.json` with passwords salted via `PASSWORD_SALT`:
  - `dealer-admin` / `password123` – role: `admin`
  - `sales-lead` / `password123` – role: `sales`
  - `marketing-ops` / `password123` – role: `marketing`
- **Login:** `POST /v1/auth/login` with `{ username, password, tenantId? }` → `accessToken`, `refreshToken`.
- **Refresh:** `POST /v1/auth/refresh` rotates refresh tokens and issues a new access token (cookie scoped to `/v1/auth/refresh`).
- **Logout:** `POST /v1/auth/logout` revokes refresh tokens.
- **Whoami:** `GET /v1/auth/me` returns the authenticated principal.
- **CSRF:** On first contact (e.g., `GET /v1/health`), a `csrfToken` cookie and header are issued when `CSRF_ENABLED=true`; include both for state-changing requests.
- **Role matrix highlights:**
  - Inventory create/update/feature: `admin`, `sales`; delete: `admin`.
  - Teams: create/update/delete `admin`, `marketing`.
  - Reviews: publish/update/delete `admin`, `marketing`.
  - Leads and timelines: `admin`, `sales`, `marketing`.
  - Settings and exports: `admin`.

### Authentication & session lifecycle
1. **Login flow** – call `POST /v1/auth/login` with credentials and optional `tenantId`. Response contains `accessToken`, `refreshToken`, and user profile. The refresh token is also set as an HttpOnly cookie scoped to `/v1/auth/refresh` for browser clients.
2. **Authenticated requests** – send `Authorization: Bearer <accessToken>` plus `X-Tenant-Id`. Access tokens encode username, role, tenant, and expiration; the auth middleware enforces expiration and role guards per route.
3. **Refresh** – call `POST /v1/auth/refresh` with the refresh cookie or bearer token to rotate tokens. Rotations are logged to `audit.log` per tenant.
4. **Logout** – call `POST /v1/auth/logout` to revoke refresh tokens and clear cookies. Access tokens naturally expire shortly after.
5. **CSRF support** – when enabled, the server sets `csrfToken` cookie + response header. Clients must echo the header for `POST/PUT/PATCH/DELETE` (configurable via `CSRF_PROTECTED_METHODS`).
6. **API key path** – service clients may send `Authorization: Bearer <API_KEY>` to skip JWT issuance; tenant scoping and role checks still apply.

### JWT claims & rotation rules
- **Claims:** `{ sub: username, role, tenantId, exp, iat }`. Only route-level guards look at `role`; tenancy validation uses `tenantId`.
- **Refresh posture:** refresh tokens are HttpOnly cookies (path `/v1/auth/refresh`) for browsers; mobile/CLI clients can pass bearer refresh tokens. Rotation is enforced—old refresh tokens are invalidated when a new one is issued.
- **Logout semantics:** clearing the refresh token cookie + in-memory revocation list blocks future refreshes. Access tokens expire quickly, so rely on refresh for long sessions.

## Multi-tenancy for dealership groups
- Requests must include `X-Tenant-Id` (or `tenantId` payload) to scope reads/writes.
- Default tenant is `main`; new tenants are initialized by `tenantService.initializeTenants()` at startup.
- Data, audit events, exports, and metrics are tenant-specific. Snapshots generated via `/v1/exports/snapshot` include only that tenant.

### Tenant bootstrapping notes
- The `main` tenant is created at startup with default fixtures. Sending a new `X-Tenant-Id` automatically initializes a fresh namespace with empty JSON files and isolated audit logs.
- When running imports or backfills, always include the tenant header to avoid seeding into the default tenant by accident.
- `GET /health` reports tenant count and data directory readiness so orchestration can check multi-tenant health.

### Tenancy behaviors and edge cases
- **Cross-tenant isolation** – inventory, leads, users, and analytics events are stored under per-tenant collections. Attempting to access a resource without a tenant returns a validation error with code `TENANT_REQUIRED`.
- **Implicit tenant creation** – sending a new `X-Tenant-Id` will initialize that namespace on demand; seed data is copied forward to preserve base roles.
- **Exports/restores** – `/v1/exports/snapshot` creates a gzip bundle with `data/*.json` scoped to the requested tenant. Use this to clone environments or capture reproducible bug states.
- **Metrics & health** – `/metrics` and `/health` report tenant counts and which data files are missing or unreadable so you can spot corrupted fixtures.

## Feature list (what the platform delivers)
- **Authentication & safety:** JWT + API-key auth, refresh rotation with revocation, CSRF protection, rate limiting, login backoff, and audit logging with masked PII.
- **Multi-tenancy:** Header- or payload-driven tenant resolution, auto-bootstrapped namespaces, per-tenant exports/audit/metrics, and per-tenant seed data.
- **Inventory & merchandising:** Full CRUD with media/story/spotlight/hotspot/badge controls, schema metadata, revision history + restore, spotlight templates, badge previews/recompute, CSV import, and merchandising toggles (feature pinning).
- **Content & site builder:** Content pages by ID or slug, preview-aware page resolver, publish scheduling, page layouts (draft/publish), block presets, redirects, sitemap generation, and SEO profile/health/topics helpers.
- **CRM & engagement:** Lead intake, scoring, bulk recompute, status updates, timelines; customer CRM; tasks and notifications; campaign creation/update/reporting; finance offers; service tickets; operational event ingestion.
- **Staff & reputation:** Team directory CRUD and public review intake with role-gated updates/deletes.
- **AI & automation:** Provider registry, observation logging, AI suggestions, assistant sessions/messages/voice/automation plans/tool listings, optional remote web fetches, and capability checklist APIs.
- **Analytics & reporting:** Event ingestion, dashboard rollups, campaign performance report, per-route metrics, and capability status map for contract checks.
- **Integrations:** Webhooks with delivery history, redirect rules, exports, audit log reader, and static dashboard hosted under `/` for quick demos.

## Full endpoint catalog (verbatim from `index.js`)
Endpoints are tenant-scoped unless noted. Role guards are listed where enforced.

**Auth & platform**
- `POST /v1/auth/login` – login and issue access/refresh tokens.
- `POST /v1/auth/refresh` – rotate refresh token (cookie or bearer accepted).
- `POST /v1/auth/logout` – revoke refresh token.
- `GET /v1/auth/me` – return authenticated user.
- `GET /v1/health` – readiness + tenant/data-dir status (public).
- `GET /v1/metrics` – per-route latency/status counts + entity totals (public but tenant-scoped).
- `GET /v1/capabilities` / `/v1/capabilities/:id` / `/v1/capabilities/status` – capability checklist and status (public).

**Inventory & merchandising**
- `GET /v1/inventory` – list inventory with filters/pagination.
- `GET /v1/inventory/stats` – aggregate stats.
- `GET /v1/inventory/slug/:slug` – lookup by slug.
- `GET /v1/inventory/:id` – inventory detail by ID.
- `GET /v1/inventory/:id/revisions` – revision history (admin/sales/marketing).
- `POST /v1/inventory/:id/revisions/:revisionId/restore` – restore a revision (admin).
- `GET /v1/inventory/:id/schema` – schema metadata for a unit.
- `POST /v1/inventory` – create (admin, sales).
- `PUT /v1/inventory/:id` – update (admin, sales).
- `PATCH /v1/inventory/:id/story` – update sales story (admin, sales).
- `PATCH /v1/inventory/:id/spotlights` – update spotlight blocks (admin, sales, marketing).
- `PATCH /v1/inventory/:id/hotspots` – update media hotspots (admin, sales, marketing).
- `PATCH /v1/inventory/:id/media` – update media list (admin, sales, marketing).
- `POST /v1/inventory/badges/preview` – preview badge outputs (admin, sales, marketing).
- `POST /v1/inventory/bulk/spotlights/apply-template` – apply a spotlight template to many units (admin, marketing).
- `POST /v1/inventory/bulk/recompute-badges` – recompute badges in bulk (admin, marketing).
- `POST /v1/inventory/import` – CSV import (admin, sales).
- `PATCH /v1/inventory/:id/feature` – toggle featured flag (admin, sales).
- `DELETE /v1/inventory/:id` – delete (admin).

**Spotlight templates**
- `GET /v1/spotlight-templates` – list templates (admin, marketing).
- `POST /v1/spotlight-templates` – create template (admin, marketing).
- `PATCH /v1/spotlight-templates/:id` – update template (admin, marketing).
- `DELETE /v1/spotlight-templates/:id` – delete template (admin, marketing).

**Content, SEO, and site builder**
- `GET /v1/content` – list content pages.
- `GET /v1/content/slug/:slug` – get content by slug.
- `GET /v1/pages/:slug` – page resolver with preview support.
- `GET /v1/content/:id` – get content by ID.
- `POST /v1/content` – create content (admin, marketing).
- `PUT /v1/content/:id` – update content (admin, marketing).
- `DELETE /v1/content/:id` – delete content (admin, marketing).
- `POST /v1/pages/:id/publish` – publish a page (admin, marketing).
- `GET /v1/content/:id/layout` – get layout draft/published (admin, marketing).
- `POST /v1/content/:id/layout` – save layout draft (admin, marketing).
- `POST /v1/content/:id/layout/publish` – publish layout (admin, marketing).
- `GET /v1/block-presets` / `POST /v1/block-presets` / `PATCH /v1/block-presets/:id` / `DELETE /v1/block-presets/:id` – builder preset CRUD (admin, marketing).
- `GET /v1/seo/profiles` – list SEO profiles (admin, marketing).
- `POST /v1/seo/profiles` – upsert SEO profile (admin, marketing).
- `POST /v1/seo/autofill` – autofill missing SEO metadata (admin, marketing).
- `GET /v1/seo/health` – SEO health report (admin, marketing).
- `GET /v1/seo/topics` – SEO topic suggestions (admin, marketing).
- `GET /v1/redirects` / `POST /v1/redirects` / `DELETE /v1/redirects/:id` – redirect rules (admin, marketing).
- `GET /v1/sitemap` – tenant sitemap (public).

**CRM: leads, tasks, notifications, customers**
- `GET /v1/leads` – list leads (admin, sales, marketing).
- `GET /v1/leads/:id` – lead detail (admin, sales, marketing).
- `GET /v1/leads/:id/score` – recompute single lead score (admin, sales, marketing).
- `POST /v1/leads/recompute-score` – bulk score recompute (admin, sales, marketing).
- `GET /v1/leads/:id/timeline` – engagement timeline (admin, sales, marketing).
- `POST /v1/leads` – intake lead (public; tenant optional for payload).
- `PUT /v1/leads/:id` – update lead (admin, sales, marketing).
- `PATCH /v1/leads/:id/status` – set status (admin, sales, marketing).
- `DELETE /v1/leads/:id` – delete (admin, marketing).
- `GET /v1/tasks` / `POST /v1/tasks` / `PATCH /v1/tasks/:id` – task CRUD (admin, sales, marketing).
- `GET /v1/notifications` / `PATCH /v1/notifications/:id` – notification list + status updates (admin, sales, marketing).
- `GET /v1/customers` / `GET /v1/customers/:id` / `POST /v1/customers` / `PUT /v1/customers/:id` / `DELETE /v1/customers/:id` – customer CRM (role-guarded delete requires admin).

**Service tickets & finance**
- `GET /v1/service-tickets` / `GET /v1/service-tickets/:id` – list/detail (admin, sales).
- `POST /v1/service-tickets` – create (admin, sales).
- `PUT /v1/service-tickets/:id` – update (admin, sales).
- `DELETE /v1/service-tickets/:id` – delete (admin).
- `GET /v1/finance-offers` / `GET /v1/finance-offers/:id` – list/detail (public).
- `POST /v1/finance-offers` / `PUT /v1/finance-offers/:id` – create/update (admin, marketing).
- `DELETE /v1/finance-offers/:id` – delete (admin).

**Campaigns & events**
- `POST /v1/events` – ingest operational event.
- `GET /v1/campaigns` – list campaigns (admin, marketing).
- `POST /v1/campaigns` – create campaign (admin, marketing).
- `PATCH /v1/campaigns/:id` – update campaign (admin, marketing).
- `GET /v1/reports/campaigns/performance` – campaign performance (admin, marketing).

**Teams & reviews**
- `GET /v1/teams` – list teams (public).
- `POST /v1/teams` / `PUT /v1/teams/:id` / `DELETE /v1/teams/:id` – manage teams (admin).
- `GET /v1/reviews` – list reviews (public).
- `POST /v1/reviews` – create review (public intake with validation).
- `PUT /v1/reviews/:id` / `DELETE /v1/reviews/:id` – update/delete (admin, sales).

**Settings**
- `GET /v1/settings` / `PUT /v1/settings` – tenant settings (admin).
- `GET /v1/settings/badge-rules` / `PATCH /v1/settings/badge-rules` – badge rule configuration (admin, marketing).
- `GET /v1/settings/lead-scoring` / `PATCH /v1/settings/lead-scoring` – lead scoring rules (admin, marketing).

**Analytics & experiments**
- `POST /v1/analytics/events` – record analytics event (public).
- `GET /v1/analytics/dashboard` – aggregated dashboard (admin, marketing).
- `POST /v1/experiments` / `PATCH /v1/experiments/:id` – create/update experiments (admin, marketing).
- `GET /v1/experiments/:id` – experiment detail (admin, marketing).

**AI providers, assistant, and web fetch**
- `GET /v1/ai/providers` / `POST /v1/ai/providers` – list/register AI providers (admin, marketing).
- `POST /v1/ai/observe` – record model observation (public/tenant optional).
- `GET /v1/ai/suggestions` – AI suggestions (admin, marketing, sales).
- `GET /v1/ai/assistant/status` – assistant readiness (admin, marketing, sales).
- `GET /v1/ai/assistant/tools` – available tools (admin, marketing, sales).
- `POST /v1/ai/assistant/voice` – save voice settings (admin, marketing).
- `POST /v1/ai/assistant/sessions` – start assistant session (admin, marketing, sales).
- `POST /v1/ai/assistant/sessions/:id/messages` – send assistant message (admin, marketing, sales).
- `POST /v1/ai/assistant/automation` / `GET /v1/ai/assistant/automation` – create/list automation plans (admin, marketing, sales).
- `POST /v1/ai/web-fetch` / `GET /v1/ai/web-fetch` – execute/list web fetches (admin, marketing).

**Integrations, exports, and observability**
- `GET /v1/webhooks` / `POST /v1/webhooks` / `PUT /v1/webhooks/:id` / `DELETE /v1/webhooks/:id` – webhook CRUD (admin, marketing).
- `GET /v1/webhooks/deliveries` – webhook delivery history (admin, marketing).
- `GET /v1/audit/logs` – audit log reader (admin).
- `GET /v1/exports/snapshot` – compressed tenant snapshot (admin).
- `GET /v1/metrics` – route metrics + rollups (public, tenant-scoped).
- `GET /v1/sitemap` – sitemap for SEO (public).
- `GET /` or `/dashboard` – static dashboard HTML demo.

## Data models & payload conventions
- **Inventory** – `id`, `stockNumber`, `vin`, `name`, `industry`, `category`, `condition`, `price`, `msrp`, `location`, `featured`, `images[]`, `stories` (rich fields), `specs` (key-value), `revisions[]` with author + timestamp.
- **Content** – `id`, `slug`, `title`, `body`, `layout` blocks, `status`, `seo` metadata. Draft/publish split handled via `layout` sub-routes.
- **CRM** – leads (`contact`, `source`, `intent`, `score`, `timeline[]`), customers, notifications, tasks, service tickets (labor/parts notes), finance offers (rate/term fields), teams, and reviews with publish flags.
- **AI** – providers (`name`, `baseUrl`, `apiKey`, `capabilities`), observations (`input`, `output`, `latencyMs`), assistant sessions (`messages[]`, `toolCalls[]`), and optional `webFetch` requests.
- **Analytics & events** – `POST /analytics/events` accepts `{ type, metadata, tenantId, user? }`; `POST /events` handles operational events.
- **Settings** – defaults load from `data/settings.json` or fall back to `src/services/state.js` (`dealershipName`, address/phone, hours, currency). Each entry is tenant-scoped and can be updated via settings APIs.

### Validation & error handling
- Schemas in `src/validation/schemas.js` define required fields, enums, and numeric ranges. Adding a route means importing the schema and attaching `validateBody|Params|Query` middleware.
- Errors use machine codes (`VALIDATION_ERROR`, `AUTH_REQUIRED`, `RATE_LIMITED`, `TENANT_REQUIRED`, etc.) with HTTP status alignment. Structured errors support `details.path` for pinpointing invalid fields.
- Inputs are sanitized before persistence; strings are trimmed and unsafe characters are neutralized for logs and responses.

### Performance & pagination
- List endpoints support pagination/query parameters defined in schemas (e.g., `page`, `pageSize`, `sort`, `filters` for inventory).
- Gzip is on by default when `COMPRESSION_ENABLED=true`; set `JSON_BODY_LIMIT_MB` to guard oversized uploads.
- `/metrics` captures per-route latency and counts for quick baselines when load testing.

## Data persistence & observability
- CRUD writes persist to `data/*.json` via `store.js`; audit trail is appended to `data/audit.log` with `PII_MASK_FIELDS` masking.
- Static files under `public/` are served alongside the API for diagnostics or simple front-end embeds.
- **Operational safeguards:** request correlation IDs, structured JSON logging, rate limiting buckets, login backoff, CSRF middleware, sanitization, gzip (when `COMPRESSION_ENABLED=true`).
- **Metrics:** per-route timing and counts are exposed at `/metrics`; health, tenant counts, and data-dir status via `/health`.

### Troubleshooting quick answers
- **Validation errors** – check `details.path` in the response; it maps directly to schema fields in `src/validation/schemas.js`.
- **401/403 issues** – confirm bearer token is fresh (not expired) and the `role` claim matches the route’s guard in `src/routes/*`.
- **Tenant not found** – include `X-Tenant-Id`; use `GET /health` to verify tenant count and data directory permissions.
- **CSRF failures** – ensure the `csrfToken` cookie is set and echoed in the header configured by `CSRF_HEADER_NAME` for mutating verbs.
- **Import failures** – invalid rows are echoed in the import response; rerun with fixed CSV and confirm `JSON_BODY_LIMIT_MB` if embedding JSON blocks.

## Useful scripts & testing
- `npm run backfill:inventory` – hydrate `data/inventory.json` with sample units (`scripts/backfillInventory.js`).
- `npm test` – executes the Node test suite under `test/`.

`scripts/backfillInventory.js` also slugifies inventory names, normalizes conditions, warns on duplicate VINs per tenant, sets sensible defaults for pricing/media fields, and ensures tenant-specific uniqueness for slugs.

### Development workflows
- **Add a route:** create a file under `src/routes/`, import schemas from `src/validation/schemas.js`, wrap with `validateBody|Params|Query`, and register the router inside `index.js`. Use `tenantService.requireTenant` and `authMiddleware.requireRole` where needed.
- **Add a service:** keep business logic in `src/services/*` and return plain objects; persistence writes should flow through `store.js` to ensure audit + tenant scoping.
- **Debugging:** tail `data/audit.log` for mutation traces; use `/health` for file/tenant readiness and `/metrics` for latency hotspots.
- **Testing:** add cases under `test/` and run `npm test`. Tests commonly boot the app, hit HTTP routes, and assert structured errors + audit behavior.

### Testing & quality gates
- **Unit/integration tests:** `npm test` uses Node’s built-in runner to spin up the app and exercise HTTP routes with fixtures.
- **Static analysis (optional):** add `npm run lint` once a linter is configured; wire into CI as part of the gate.
- **Contract checks:** the capability list exposed at `/v1/capabilities/status` doubles as a lightweight contract for front-end + automation clients—keep it in sync when adding features.
- **What tests cover today:**
  - `test/authCsrf.integration.test.js` – CSRF cookie/header issuance, protected verb behavior, and auth flows.
  - `test/inventoryService.test.js` + `test/inventoryEnhancements.test.js` – CRUD, badge/revision logic, and schema-driven behaviors for inventory.
  - `test/leadScoring.test.js` and `test/leadEngagement.test.js` – scoring heuristics and engagement timeline handling.
  - `test/campaignAttribution.test.js` – campaign performance/attribution calculations.
  - `test/seoRedirects.test.js` + `test/seoTopics.test.js` – SEO profile/redirect helpers.
  - `test/siteBuilderEnhancements.test.js` – layout/preset behaviors for the site builder APIs.

### Deployment profiles
- **Local/dev:** run `npm start` with `.env` plus file-backed persistence; ideal for demos and QA.
- **Containerized:** mount `data/` as a volume for persistence across restarts; set `ENFORCE_HTTPS=true` and configure proxy headers.
- **Staging/production:** swap `store.js` with a database adapter using the same interface (see `Extending functionality`) and ship logs to an observability stack. Keep `API_KEY` in a secret store and rotate `JWT_SECRET` periodically.

## Bulk import runbook (CSV → `/v1/inventory/import`)
Use multipart form-data with field `file` and header `X-Tenant-Id`. Supported columns include `stockNumber`, `vin`, `name`, `industry`, `category`, `condition`, `price`, `msrp`, `location`, `featured`, plus storytelling fields. Minimal CSV:

```csv
stockNumber,vin,name,industry,category,condition,price,msrp,location,featured
D3350,1FADP3E20FL123456,Georgetown GT5 35K7,RV,Motorhome,new,189999,214999,lexington,true
```

Troubleshooting tips:
- Match headers exactly; normalize `condition` to `new|used|demo|pending_sale`.
- Include tenant (`X-Tenant-Id` or `tenantId`) so units stay scoped.
- Failed rows are returned with messages—fix and re-upload; partial successes persist.
- Use `curl -F "file=@inventory.csv" http://localhost:3000/v1/inventory/import -H "X-Tenant-Id: main" -H "Authorization: Bearer <token>"` to test quickly.
- Large files: bump `JSON_BODY_LIMIT_MB` if you embed JSON fields; CSV rows stream without that limit but validations still run per-row.
- Audit trail: every row mutation is appended to `data/audit.log` with masked VIN/PII.

## Extending functionality
The backend ships with auth, pagination, filtering, rate limiting, CSRF, role-based authorization, analytics, AI hooks, and webhooks. Next steps:
- Full-text search/sort for inventory and specs.
- Object storage for media on units, staff, and content pages.
- WebSockets/SSE for live inventory/lead updates alongside webhooks.
- Database adapter to replace JSON persistence.
- OpenAPI spec + generated SDKs.

### Production-hardening checklist
- Add HTTPS termination and trusted proxy configuration for real deployments when `ENFORCE_HTTPS=true`.
- Wire CI to run `npm test`, linting, and vulnerability scanning; gate merges on green checks.
- Promote the static API key to a secret manager and rotate `JWT_SECRET` regularly.
- Move persistence to a managed database (PostgreSQL/Mongo) using the `store` abstraction as the seam.
- Enable audit shipping to an external log sink with retention policies.
- Document SLAs and alert thresholds using `/metrics` signals.

## 100 must-have capabilities for a best-in-class RV dealership backend
These items are exposed via `/v1/capabilities` (full list) and `/v1/capabilities/:id` (single). `/v1/capabilities/status` reports implementation status for automation checks.

1. Layered architecture separating routing, business logic and persistence for clarity.
2. Domain models for inventory, leads, customers, service tickets and finance offers.
3. Clear API versioning strategy (e.g. `/v1`, `/v2`) to support breaking changes.
4. Centralized validation layer with reusable schemas for every endpoint.
5. Strong typing via TypeScript or a schema-first tool like OpenAPI or Zod.
6. Consistent error-handling middleware with machine-readable error codes.
7. Request correlation IDs for tracing complex user journeys across services.
8. Structured JSON logging with log levels and request context metadata.
9. Configurable rate limiting to protect public endpoints from abuse.
10. Built-in JWT or OAuth2 authentication with refresh token rotation.
11. Role-based access control with granular permissions per resource.
12. Multi-tenancy support for multi-location dealership groups.
13. Environment-based configuration management with secrets stored securely.
14. HTTPS enforcement and HSTS headers for all deployed environments.
15. Input sanitization and output escaping to mitigate injection risks.
16. CSRF protection for browser-based consumers.
17. Secure cookie settings with SameSite and HttpOnly flags where applicable.
18. Automated security scanning for dependencies and container images.
19. Audit logging for changes to sensitive data such as pricing and discounts.
20. Data retention policies with automatic archival and deletion routines.
21. Configurable PII masking for logs and exports.
22. GDPR/CCPA-compliant consent tracking for lead capture and marketing.
23. Inventory schema that tracks VIN, year, length, weight and chassis details.
24. Support for multiple condition states (new, used, demo, pending sale).
25. Pricing fields for MSRP, sale price, rebates, taxes and fees.
26. Location-aware stock with transfer and hold statuses across lots.
27. Media management for photos, 360 tours, floorplans and video links.
28. Automated image optimization and CDN delivery for media assets.
29. Bulk import/export of inventory via CSV, Excel and DMS integrations.
30. Integration hooks for dealer management systems (DMS) and OEM feeds.
31. Real-time availability sync with third-party marketplaces (RV Trader, etc.).
32. Workflow rules for reconditioning, detail and photography steps.
33. Service scheduling APIs for pre-delivery inspections and warranty work.
34. Lead capture endpoints for web forms, chatbots, phone logs and QR codes.
35. Lead enrichment via third-party data (credit, trade-in valuation, geo lookup).
36. Automated lead assignment based on territory, product line or availability.
37. Lead scoring that blends engagement, credit tier and inventory fit.
38. Task and reminder system for follow-ups with due dates and outcomes.
39. Communication logs capturing calls, SMS, emails and in-person visits.
40. Email/SMS templates with personalization tokens and A/B testing support.
41. Unified customer profile combining lead data, purchase history and service.
42. Quoting engine for monthly payments with lender rate tables and terms.
43. Digital desking flows for F&I products, warranties and protection plans.
44. Trade-in appraisal workflows with photo capture and condition checklists.
45. Document generation for purchase agreements and disclosures.
46. E-signature integration for contracts and consent forms.
47. Appointment scheduling with calendar sync to staff calendars.
48. Test drive slot management with vehicle hold logic.
49. Delivery scheduling and checklists for walkthroughs and accessories.
50. Integration with parts inventory for accessory bundles.
51. Aftermarket upsell tracking (solar kits, towing packages, extended service).
52. Service ticketing with labor, parts, sublet and warranty claim tracking.
53. Warranty claims submission to OEM portals with status callbacks.
54. Recall management with VIN lookups and customer notification tooling.
55. Maintenance schedules and reminders tied to unit usage and seasons.
56. Rental module for units with availability calendars and damage deposits.
57. Fleet management for loaners and courtesy vehicles.
58. Robust search with filters for specs, price ranges, lifestyle tags and features.
59. Personalized recommendations using browsing history and saved searches.
60. Saved favorites and watchlists with price drop notifications.
61. SEO-friendly URL slugs and metadata for unit detail pages served by the API.
62. Content management for blog posts, FAQs and landing pages.
63. Configurable merchandising rules (featured, clearance, seasonal campaigns).
64. Dynamic banners and badges (e.g., "New Arrival", "Price Drop", "Certified").
65. Geo-aware location selection and language/currency localization.
66. Tax calculation service that respects location-based rules.
67. Shipping/delivery quotes with integrations to logistics partners.
68. Payment gateway integration for deposits and online reservations.
69. Support for alternative payments (ACH, financing pre-approvals, wallet).
70. Real-time analytics events for lead submissions, searches and conversions.
71. Dashboard KPIs for sales velocity, days on lot, gross margin and CSI scores.
72. Funnel analytics for lead response times and pipeline conversion rates.
73. A/B testing hooks for pricing strategies and promotional copy.
74. Data warehouse exports and BI connectors (Snowflake, BigQuery, Redshift).
75. Webhooks for inventory updates, lead status changes and appointments.
76. Event-driven architecture with queues for async tasks and retries.
77. Caching layer for read-heavy endpoints with cache invalidation policies.
78. Full-text search index for inventory and content.
79. GraphQL gateway for flexible front-end consumption when needed.
80. gRPC/internal APIs for high-performance service-to-service calls.
81. Health checks and readiness probes for container orchestration.
82. Distributed tracing instrumentation (OpenTelemetry) across services.
83. Metrics collection (latency, throughput, error rates) with alerting.
84. Feature flag system for gradual rollouts and safe experimentation.
85. Blue/green and canary deployment strategies with automated rollbacks.
86. Infrastructure-as-code definitions for repeatable environments.
87. CI/CD pipelines with linting, tests, security scans and preview deployments.
88. Comprehensive unit, integration and contract tests for all endpoints.
89. Test data factories and seed scripts for realistic demo environments.
90. Local developer environment using containers and seeded fixtures.
91. API documentation with OpenAPI/Swagger and interactive consoles.
92. SDKs or client libraries for JavaScript, Python and mobile platforms.
93. Sandbox mode for partners to test against without affecting production data.
94. Rate- and quota-tracking for partner integrations with billing hooks.
95. Support SLAs with uptime reporting and status page integrations.
96. Accessibility-friendly responses and content for ADA compliance.
97. Localization files for multi-language content and communications.
98. Backup and disaster recovery runbooks with tested restore drills.
99. Immutable event log or change data capture stream for analytics.
100. Observability-driven postmortem process with action item tracking.

### Digital experience capabilities
- **SEO profiles.** Manage metadata via `GET/POST /seo/profiles` and auto-fill missing records with `POST /seo/autofill`.
- **Analytics dashboard.** Emit events (`POST /analytics/events`) and review consolidated tenant view at `/analytics/dashboard`.
- **Layout drafts.** Save page builder blocks/widgets with `POST /content/:id/layout`, publish via `/content/:id/layout/publish`.
- **AI control center.** Register providers (`POST /ai/providers`), capture observations (`POST /ai/observe`), request suggestions (`GET /ai/suggestions`), and optionally run remote lookups (`POST /ai/web-fetch`) when `AI_WEB_FETCH=true`.

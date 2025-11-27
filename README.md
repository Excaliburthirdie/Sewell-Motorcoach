# RV Dealer Backend

This project is a simplified backend for an RV dealership.  It aims to reproduce
the core functionality observed in the Sewell Motorcoach WordPress backend
while using modern technology.  It provides RESTful endpoints for managing
inventory, staff teams, customer reviews, leads and dealership settings.

The server is built with [Express](https://expressjs.com/) and stores its
data in JSON files under the `data/` directory for ease of use.  You can
swap the data layer for a real database (such as PostgreSQL, MySQL or
MongoDB) by replacing the helper functions in `index.js`.

## Features

The API is built to mirror a dealership-grade control center. Every resource is scoped to a tenant (location) and guarded by
JWT-based auth with optional legacy API key support. Highlights include:

- **Inventory management** – full CRUD, featured toggling, slug lookups, stats rollups, CSV import and pricing change audits with
  revision history for storytelling fields and badge previews.
- **Team (staff) management** – teams with members, roles and biographies plus CRUD for marketing/admin roles.
- **Customer reviews** – collect, publish and moderate reviews with ratings and visibility flags.
- **Lead collection** – unauthenticated lead intake with status updates, assignments and webhook notifications.
- **Dealership settings** – update location/contact metadata per tenant with admin-only access.
- **Customer CRM** – track contact preferences, opt-ins and lifecycle details for buyers and prospects.
- **Service tickets** – log issues with line items, technician info, scheduling and status management.
- **Finance offers** – manage lender programs and publish current rate/term blocks with marketing/admin permissions.
- **Content pages & sitemap** – create marketing pages, fetch by slug, export a sitemap, and manage per-page drafts/publishing for
  page-builder layouts.
- **SEO management** – store SEO profiles, auto-fill missing records, and scope metadata to any resource.
- **Analytics & events** – accept analytics events, view dashboard rollups, and emit internal events for metrics aggregation.
- **Sales engagement** – manage tasks, notifications, and per-lead timelines that unify events, follow-ups, and alerts.
- **AI control center** – register AI providers, capture observations, fetch AI suggestions, and optionally run remote web fetches
  (gated by `AI_WEB_FETCH`).
- **Webhooks** – create/update/delete outbound webhooks, list deliveries, and trigger them automatically on key events
  (inventory, leads, customers, finance offers, service tickets).
- **Audit logging & exports** – record every mutation to `data/audit.log` and generate compressed tenant snapshots for offline
  inspection.
- **Operational safeguards** – CSRF cookies/headers, rate limiting, input sanitization, HSTS enforcement, gzip compression,
  per-route metrics, login backoff, and structured JSON logging with request correlation IDs.

Each resource is exposed via a dedicated REST endpoint. The API can be consumed by a front‑end application, fed into WordPress,
or integrated with automation platforms via webhooks and exports.

## Getting started

1. **Install Node.js** – version 14 or higher is recommended.  You can
   download Node.js from [nodejs.org](https://nodejs.org/).

2. **Install dependencies.**  From within the `backend` directory run:

   ```sh
   npm install
   ```

3. **Configure environment.** Copy `.env.example` to `.env` and set secrets
   such as `JWT_SECRET`, `API_KEY`, and `DEFAULT_TENANT_ID` for your
   dealership locations. The app also respects process environment variables
   directly when running in containerised or hosted environments.

4. **Start the server.**  The default port is `3000`, but you can set
   the `PORT` environment variable to change it:

   ```sh
   # start the backend
   npm start
   # or for live reload during development
   npm run dev
   ```

4. **Access the API.**  Once running, you can open a browser or use
   `curl`/Postman to interact with the endpoints.  For example:

   ```sh
   curl http://localhost:3000/inventory
   curl -X POST http://localhost:3000/inventory \
        -H "Content-Type: application/json" \
        -d '{"stockNumber":"D3350","industry":"RV","category":"Motorhome"}'
  ```

### Endpoints

All endpoints are available both at the root and under `/v1` for versioned consumption. Protected requests use JWT bearer tokens
with refresh rotation, while the static bearer token (`API_KEY`) remains for service-to-service compatibility.

### Authentication & session lifecycle

- **Login:** `POST /auth/login` with `{ "username": "dealer-admin", "password": "password123" }` (default
  seed user). Returns an `accessToken` (short-lived) and `refreshToken` (long-lived).
- **Refresh:** `POST /auth/refresh` with `{ "refreshToken": "<token>" }` to rotate refresh tokens and issue a new
  access token. The previous refresh token is revoked when a new one is issued.
- **Logout/Revoke:** `POST /auth/logout` with the refresh token to revoke it explicitly.
- **Whoami:** `GET /auth/me` returns the authenticated principal using the supplied bearer token.

#### Auth configuration

- `JWT_SECRET` – required in production; used to sign access and refresh tokens (default: `change-me-in-prod`).
- `ACCESS_TOKEN_TTL_SECONDS` – lifetime for access tokens (default: `900`).
- `REFRESH_TOKEN_TTL_SECONDS` – lifetime for refresh tokens with rotation (default: 7 days).
- `PASSWORD_SALT` – salt used to hash seed user passwords; default aligns with the bundled seed user.
- `API_KEY` – optional static bearer token for service-to-service or legacy automation calls.

#### Role-based access control

Seed users are provided for local testing:

- `dealer-admin` / `password123` – role: `admin` (full access)
- `sales-lead` / `sales123` – role: `sales` (inventory + leads)
- `marketing-ops` / `marketing123` – role: `marketing` (reviews, teams, leads)

Protected routes enforce the following role matrix:

- **Inventory** create/update/feature: `admin`, `sales`; delete: `admin`.
- **Teams** create/update/delete: `admin`, `marketing`.
- **Reviews** create/update/delete/visibility: `admin`, `marketing`.
- **Leads** create/update/status/delete: `admin`, `sales`, `marketing`.
- **Settings** update: `admin`.

Unauthorized or insufficient roles return a `403` error with a structured machine-readable error code.

### Multi-tenancy for dealership groups

- **Tenant resolution.** Supply `X-Tenant-Id` (or a `tenantId` query/body field) on every request to scope reads and writes to a
  specific dealership location. Requests without a tenant default to `main`.
- **Seed tenants.** Two locations are provided out of the box: `main` (Harrodsburg) and `lexington`. Add more by editing
  `data/tenants.json`.
- **Tenant-aware auth.** Login and refresh tokens encode the tenant, and protected endpoints enforce that the bearer token’s
  tenant matches the requested tenant to prevent cross-location data leakage.
- **Tenant-scoped resources.** Inventory, teams, reviews, leads, customers, finance offers, service tickets, and settings are
  all filtered and persisted per-tenant automatically. Metrics and audit logs include the tenant identifier for traceability.

### Request headers & CSRF expectations

- **Tenant header required.** Send `X-Tenant-Id` on every request (or a `tenantId` field) to ensure data isolation.
- **CSRF cookie + header.** The API issues a `csrfToken` cookie and matching `X-CSRF-Token` response header on first contact
  (e.g., `GET /v1/health`). Include both the cookie and header on subsequent state-changing requests.
- **Refresh flow.** Refresh tokens are stored in the `refreshToken` HttpOnly cookie and must be accompanied by the matching
  CSRF header when calling `POST /v1/auth/refresh`.
- **Legacy automation.** Service-to-service calls can still use the static bearer token (`API_KEY`) when configured, but
  browser clients should prefer JWT + CSRF for session safety.

### Bulk inventory import runbook

A step-by-step import guide (CSV layout, authentication flow, and troubleshooting) is available in
[`docs/import-runbook.md`](docs/import-runbook.md).

### Testing

- **Unit suite:** Uses Node's built-in test runner. Run `npm test` to execute the fast unit coverage for services.
- **Integration coverage:** Auth + CSRF integration tests require the Express stack and the optional `supertest` dev dependency. They are skipped by default; install dev dependencies and set `RUN_INTEGRATION_TESTS=true` before `npm test` to enable them.

### Validation, errors and observability

- **Schema-first validation.** Every request body, query and route parameter is
  validated with reusable schemas before entering business logic to keep data
  consistent and predictable across the API surface.
- **Machine-readable errors.** Failures return a JSON payload with an error
  `code`, human-readable `message` and the `requestId` that traces the request
  end-to-end.
- **Correlation-aware logging.** Requests and errors are logged as structured
  JSON with log levels, durations and correlation IDs so you can trace
  cross-service flows quickly.
- **Rate limiting.** Public endpoints are protected by a configurable
  window/max limiter that returns a standardized error code when exceeded.
- **HTTPS enforcement.** When `ENFORCE_HTTPS=true`, the API rejects downgraded
  traffic and sends HSTS headers (`Strict-Transport-Security`) with the
  configured max-age for secure deployments.
- **CSRF protection.** Clients receive a `csrfToken` cookie + header and must echo them for state-changing requests, including
  refresh token rotation.
- **Input sanitization.** Requests are sanitized to strip control characters and dangerous strings before validation.
- **Optional API key.** Legacy automations can still use the static bearer token (`API_KEY`) in lieu of JWT if configured.
- **Compression and perf.** Responses are gzipped when supported, and per-route metrics summarize latency and status counts.
- **Abuse safeguards.** Login attempts apply exponential backoff, and every mutation writes to `data/audit.log` with masked
  sensitive fields.

| Method | Endpoint                           | Purpose                                                        |
|-------:|------------------------------------|----------------------------------------------------------------|
|  POST  | `/auth/login`                      | Obtain JWT access/refresh tokens and CSRF token                |
|  POST  | `/auth/refresh`                    | Rotate refresh token and get new access token                  |
|  POST  | `/auth/logout`                     | Revoke a refresh token and clear cookies                       |
|  GET   | `/auth/me`                         | Return the authenticated principal                             |
|   GET  | `/capabilities`                    | List all 100 best-in-class capabilities                        |
|   GET  | `/capabilities/:id`                | Retrieve a capability by ID                                    |
|   GET  | `/capabilities/status`             | Report implementation status for the capability checklist      |
|   GET  | `/inventory`                       | List all inventory units with filters                          |
|   GET  | `/inventory/stats`                 | Aggregate inventory stats per tenant                           |
|   GET  | `/inventory/:id`                   | Retrieve a single unit by ID                                   |
|   GET  | `/inventory/slug/:slug`            | Retrieve a single unit by slug                                 |
|   GET  | `/inventory/:id/revisions`         | List revision history for storytelling fields                  |
|  POST  | `/inventory/:id/revisions/:revisionId/restore` | Restore a prior storytelling revision (admin)          |
|   POST | `/inventory`                       | Create a new unit (admin/sales)                                |
|   POST | `/inventory/badges/preview`        | Compute badges for a draft payload (admin/sales/marketing)     |
|   POST | `/inventory/bulk/spotlights/apply-template` | Apply a saved spotlight template to units (admin/marketing) |
|   POST | `/inventory/bulk/recompute-badges` | Recompute badges for select or all units (admin/marketing)     |
|   POST | `/inventory/import`                | Bulk import inventory from CSV (admin/sales)                   |
|   PUT  | `/inventory/:id`                   | Update an existing unit (admin/sales)                          |
|  PATCH | `/inventory/:id/feature`           | Toggle featured flag (admin/sales)                             |
| DELETE | `/inventory/:id`                   | Delete a unit (admin)                                          |
|   GET  | `/spotlight-templates`             | List spotlight templates (admin/marketing)                     |
|   POST | `/spotlight-templates`             | Create a spotlight template (admin/marketing)                  |
|  PATCH | `/spotlight-templates/:id`         | Update a spotlight template (admin/marketing)                  |
| DELETE | `/spotlight-templates/:id`         | Delete a spotlight template (admin/marketing)                  |
|   GET  | `/content`                         | List content pages                                             |
|   GET  | `/content/:id`                     | Retrieve a content page by ID                                  |
|   GET  | `/content/slug/:slug`              | Retrieve a content page by slug                                |
|   GET  | `/pages/:slug?mode=preview`        | Retrieve published pages or draft preview when authenticated   |
|   POST | `/content`                         | Create a content page (admin/marketing)                        |
|   PUT  | `/content/:id`                     | Update a content page (admin/marketing)                        |
| DELETE | `/content/:id`                     | Delete a content page (admin/marketing)                        |
|   POST | `/pages/:id/publish`               | Publish immediately or schedule a content page (admin/marketing) |
|   GET  | `/content/:id/layout`              | Retrieve layout draft/published blocks (admin/marketing)       |
|   POST | `/content/:id/layout`              | Save a layout draft (admin/marketing)                          |
|   POST | `/content/:id/layout/publish`      | Publish a saved layout draft (admin/marketing)                 |
|   GET  | `/block-presets`                   | List reusable block presets (admin/marketing)                  |
|   POST | `/block-presets`                   | Create a block preset (admin/marketing)                        |
|  PATCH | `/block-presets/:id`               | Update a block preset (admin/marketing)                        |
| DELETE | `/block-presets/:id`               | Delete a block preset (admin/marketing)                        |
|   POST | `/experiments`                     | Create an A/B experiment (admin/marketing)                     |
|  PATCH | `/experiments/:id`                 | Update an A/B experiment (admin/marketing)                     |
|   GET  | `/experiments/:id`                 | Retrieve experiment config and metrics (admin/marketing)       |
|   GET  | `/seo/profiles`                    | List SEO profiles for a resource (admin/marketing)             |
|   POST | `/seo/profiles`                    | Upsert a SEO profile (admin/marketing)                         |
|   POST | `/seo/autofill`                    | Auto-create missing SEO profiles (admin/marketing)             |
|   GET  | `/leads`                           | List leads with filters (admin/sales/marketing)                |
|   GET  | `/leads/:id`                       | Retrieve a lead by ID (admin/sales/marketing)                  |
|   GET  | `/leads/:id/score`                 | Recompute and return lead score + reasons (admin/sales/marketing) |
|   POST | `/leads`                           | Record a new lead submission                                   |
|   PUT  | `/leads/:id`                       | Update lead details (admin/sales/marketing)                    |
|  PATCH | `/leads/:id/status`                | Update lead status (admin/sales/marketing)                     |
|  POST | `/leads/recompute-score`            | Bulk recompute scores for provided leads (admin/sales/marketing) |
| DELETE | `/leads/:id`                       | Delete a lead (admin/marketing)                                |
|   GET  | `/settings/lead-scoring`           | Retrieve tenant scoring rules (admin/marketing)                |
|  PATCH | `/settings/lead-scoring`           | Update tenant scoring rules (admin/marketing)                  |
|   GET  | `/campaigns`                       | List campaigns (admin/marketing)                               |
|   POST | `/campaigns`                       | Create a campaign (admin/marketing)                            |
|  PATCH | `/campaigns/:id`                   | Update a campaign (admin/marketing)                            |
|   GET  | `/reports/campaigns/performance`   | Campaign performance metrics (admin/marketing)                 |
|   GET  | `/customers`                       | List customers with pagination/filters (admin/sales/marketing) |
|   GET  | `/customers/:id`                   | Retrieve a customer by ID (admin/sales/marketing)              |
|   POST | `/customers`                       | Create a customer (admin/sales/marketing)                      |
|   PUT  | `/customers/:id`                   | Update a customer (admin/sales/marketing)                      |
| DELETE | `/customers/:id`                   | Delete a customer (admin)                                      |
|   GET  | `/service-tickets`                 | List service tickets with status filters (admin/sales)         |
|   GET  | `/service-tickets/:id`             | Retrieve a service ticket by ID (admin/sales)                  |
|   POST | `/service-tickets`                 | Create a service ticket (admin/sales)                          |
|   PUT  | `/service-tickets/:id`             | Update a service ticket (admin/sales)                          |
| DELETE | `/service-tickets/:id`             | Delete a service ticket (admin)                                |
|   GET  | `/finance-offers`                  | List lender offers with pagination                             |
|   GET  | `/finance-offers/:id`              | Retrieve a finance offer by ID                                 |
|   POST | `/finance-offers`                  | Create a finance offer (admin/marketing)                       |
|   PUT  | `/finance-offers/:id`              | Update a finance offer (admin/marketing)                       |
| DELETE | `/finance-offers/:id`              | Delete a finance offer (admin)                                 |
|   GET  | `/teams`                           | List staff teams                                               |
|   POST | `/teams`                           | Create a team (admin)                                          |
|   PUT  | `/teams/:id`                       | Update a team (admin)                                          |
| DELETE | `/teams/:id`                       | Delete a team (admin)                                          |
|   GET  | `/reviews`                         | List reviews                                                   |
|   POST | `/reviews`                         | Add a review                                                   |
|   PUT  | `/reviews/:id`                     | Update a review (admin/sales)                                  |
| DELETE | `/reviews/:id`                     | Delete a review (admin/sales)                                  |
|   GET  | `/settings`                        | Retrieve dealership settings (admin)                           |
|   PUT  | `/settings`                        | Update dealership settings (admin)                             |
|   GET  | `/sitemap`                         | Generate a sitemap of inventory and content pages              |
|   GET  | `/seo/health`                      | Tenant SEO diagnostics (admin/marketing)                       |
|   GET  | `/analytics/dashboard`             | Tenant analytics dashboard (admin/marketing)                   |
|   POST | `/analytics/events`                | Record analytics events                                        |
|   POST | `/events`                          | Record operational events that feed rollups                    |
|   GET  | `/ai/providers`                    | List AI providers (admin/marketing)                            |
|   POST | `/ai/providers`                    | Register an AI provider (admin/marketing)                      |
|   POST | `/ai/observe`                      | Record an AI observation                                       |
|   GET  | `/ai/suggestions`                  | Retrieve AI suggestions (admin/marketing/sales)                |
|   POST | `/ai/web-fetch`                    | Run a remote web fetch (admin/marketing)                       |
|   GET  | `/ai/web-fetch`                    | List past web fetches (admin/marketing)                        |
|   GET  | `/redirects`                       | List redirect rules (admin/marketing)                          |
|   POST | `/redirects`                       | Create a redirect rule (admin/marketing)                       |
| DELETE | `/redirects/:id`                   | Delete a redirect (admin/marketing)                            |
|   GET  | `/webhooks`                        | List webhooks (admin/marketing)                                |
|   GET  | `/webhooks/deliveries`             | List webhook deliveries (admin/marketing)                      |
|   POST | `/webhooks`                        | Create a webhook (admin/marketing)                             |
|   PUT  | `/webhooks/:id`                    | Update a webhook (admin/marketing)                             |
| DELETE | `/webhooks/:id`                    | Delete a webhook (admin/marketing)                             |
|   GET  | `/audit/logs`                      | View audit log records (admin)                                 |
|   GET  | `/exports/snapshot`                | Generate a compressed tenant snapshot (admin)                  |
|   GET  | `/metrics`                         | Route performance + resource counts + daily rollups            |
|   GET  | `/health`                          | Health check with uptime, tenant count and data-dir status     |

### Persisting data

By default the backend uses the JSON files under `data/` as a simple
persistent store.  When you modify or add new records, the data is
written back to disk.  For production use you should replace this
mechanism with a proper database.  See the functions `loadData()` and
`saveData()` in `index.js` for where to plug in your own persistence
layer.

### Operational safeguards and observability

- **Request correlation IDs** are attached to every response via the
  `X-Request-Id` header.
- **Structured request logging** captures method, path, status code and
  duration in JSON.
- **Rate limiting** protects the API by default (300 requests per minute
  per IP, configurable via environment variables).
- **Audit logging** writes all create/update/delete operations to
  `data/audit.log` alongside the request identifier and payload.
- **Health** and **metrics** endpoints provide lightweight readiness
  signals for orchestration and dashboards.

## Extending functionality

The backend already ships with authentication, pagination, filtering, rate limiting, CSRF, role-based authorization and webhook
automation. Possible next steps include:

- **Search & sort enhancements** – full-text search for inventory/specs and richer sort orders.
- **File uploads** – integrate with object storage for media on inventory, staff and content pages.
- **Realtime updates** – push inventory/lead changes over WebSockets or server-sent events alongside existing webhooks.
- **Database adapter** – swap the JSON persistence layer for a relational/NoSQL data store with migrations.
- **OpenAPI/SDKs** – publish an OpenAPI spec and generate client SDKs for consumers.

Feel free to tailor the code to your needs and build upon the foundation provided here.

## Bulk import runbook

Use the `/inventory/import` endpoint to seed or update listings in bulk. The importer accepts CSV with headers such as
`stockNumber`, `vin`, `name`, `industry`, `category`, `condition`, `price`, `msrp`, `location`, and `featured`.

1. Prepare a CSV file using UTF-8 encoding. A minimal row might look like:

   ```csv
   stockNumber,vin,name,industry,category,condition,price,msrp,location,featured
   D3350,1FADP3E20FL123456,Georgetown GT5 35K7,RV,Motorhome,new,189999,214999,lexington,true
   ```

2. Include your tenant in the request as `X-Tenant-Id` or `tenantId` to keep data scoped correctly.
3. POST the CSV file using multipart form data to `/v1/inventory/import` with the file field named `file`.
4. Verify the response for any rejected rows. Common issues include missing VIN/stock numbers, unsupported `condition`
   values, or duplicate VINs within the same tenant.
5. If the importer reports validation errors, correct the CSV and re-run the request. Partial successes are persisted;
   failed rows are returned with error messages for quick remediation.

Troubleshooting tips:

- Ensure CSV headers exactly match the fields expected by the importer.
- Normalize `condition` values to one of `new`, `used`, `demo`, or `pending_sale`.
- When testing locally, remove cached uploads between runs to avoid stale files and reset tenants with fresh fixtures if needed.

## 100 must-have capabilities for a best-in-class RV dealership backend

These items are also exposed via the API at `GET /capabilities` (full
list) and `GET /capabilities/:id` (single item) for front-end display or
automation workflows.  The `GET /capabilities/status` endpoint reports the
implementation status of all items so integrations can verify that the
full checklist is available.

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

- **SEO profiles.** Manage per-page and per-inventory metadata via `GET/POST /seo/profiles` and auto-generate missing records with
  `POST /seo/autofill`.
- **Analytics dashboard.** Emit lightweight analytics events (`POST /analytics/events`) and review the consolidated tenant view at
  `GET /analytics/dashboard`.
- **Layout drafts.** Use `POST /content/:id/layout` to save page builder blocks/widgets, then publish with
  `POST /content/:id/layout/publish`.
- **AI control center.** Register providers (`POST /ai/providers`), capture observations (`POST /ai/observe`), request AI-backed
  suggestions (`GET /ai/suggestions`) and optionally run remote lookups (`POST /ai/web-fetch`) when `AI_WEB_FETCH=true`.

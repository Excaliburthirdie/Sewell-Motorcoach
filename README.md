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

- **Inventory management** – create, read, update and delete RV units.
- **Team (staff) management** – organise staff into teams with members and
  biographies.
- **Customer reviews** – store reviews with ratings and visibility flags.
- **Lead collection** – record submissions from contact forms.
- **Dealership settings** – update contact information and other config.

Each resource is exposed via a separate REST endpoint.  The API can be
consumed by a front‑end application or even imported into WordPress via
HTTP.

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

All endpoints are available both at the root and under `/v1` for versioned
consumption. Protected requests now support JWT-based authentication with
refresh token rotation while still honoring the legacy static bearer token
(`API_KEY`) for compatibility.

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

| Method | Endpoint         | Purpose                                     |
|-------:|------------------|---------------------------------------------|
|  POST  | `/auth/login`    | Obtain JWT access and refresh tokens        |
|  POST  | `/auth/refresh`  | Rotate refresh token and get new access     |
|  POST  | `/auth/logout`   | Revoke a refresh token                      |
|  GET   | `/auth/me`       | Return the authenticated principal          |
|  GET   | `/inventory`     | List all inventory units                     |
|  GET   | `/inventory/:id` | Retrieve a single unit by ID                |
|  POST  | `/inventory`     | Create a new unit                           |
|  PUT   | `/inventory/:id` | Update an existing unit                     |
|  DELETE| `/inventory/:id` | Delete a unit                               |
|  GET   | `/teams`         | List all staff teams                        |
|  GET   | `/teams/:id`     | Retrieve a team by ID                       |
|  POST  | `/teams`         | Create a new team                           |
|  PUT   | `/teams/:id`     | Update a team                               |
|  DELETE| `/teams/:id`     | Delete a team                               |
|  GET   | `/reviews`       | List all reviews                            |
|  GET   | `/reviews/:id`   | Retrieve a review by ID                     |
|  POST  | `/reviews`       | Add a new review                            |
|  PUT   | `/reviews/:id`   | Update a review                             |
|  DELETE| `/reviews/:id`   | Delete a review                             |
|  GET   | `/capabilities`  | List all 100 best-in-class capabilities     |
|  GET   | `/capabilities/:id` | Retrieve a specific capability by ID      |
|  GET   | `/capabilities/status` | Report aggregate implementation status |
|  GET   | `/leads`         | List all leads                              |
|  GET   | `/leads/:id`     | Retrieve a lead by ID                       |
|  POST  | `/leads`         | Record a new lead submission                |
|  PUT   | `/leads/:id`     | Update a lead                               |
|  DELETE| `/leads/:id`     | Delete a lead                               |
|  GET   | `/settings`      | Retrieve dealership settings                |
|  PUT   | `/settings`      | Update dealership settings                  |
|  GET   | `/health`        | Health check with uptime and request ID     |
|  GET   | `/metrics`       | Lightweight resource metrics                |

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

This project provides a starting point for building a full‑featured
dealership backend.  You may wish to extend it with the following:

- **Authentication & authorization** – add JWT or session-based auth to
  protect endpoints.
- **Pagination & filtering** – support query parameters for listing
  endpoints (e.g. `GET /inventory?page=2&limit=10`).
- **Search & sort** – allow sorting by price, year, length, etc. and
  searching by keyword.
- **File uploads** – integrate with a storage service (AWS S3, local
  filesystem) to handle image uploads for inventory units and staff
  members.
- **Integration with front‑end frameworks** – connect the API to a
  React, Vue or Angular front end or to a WordPress site via REST.

Feel free to tailor the code to your needs and build upon the
foundation provided here.

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

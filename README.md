# RV Dealer Backend

This project is a full‑featured backend for an RV dealership.  It aims to
reproduce the core functionality observed in the Sewell Motorcoach WordPress
backend while using modern technology.  It provides RESTful endpoints for
managing inventory, staff teams, customer reviews, leads and dealership
settings.  Additional modules now cover tasks, appointments, announcements,
CMS pages, FAQs, automations, webhooks, integrations, reporting, exports and a
dashboard for at‑a‑glance operational insight.

The server is built with [Express](https://expressjs.com/) and stores its
data in JSON files under the `data/` directory for ease of use.  You can
swap the data layer for a real database (such as PostgreSQL, MySQL or
MongoDB) by replacing the helper functions in `index.js`.

## Features

- **Inventory management** – create, read, update and delete RV units with
  filtering, sorting and spotlight support.
- **Team (staff) management** – organise staff into teams with members and
  biographies.
- **Customer reviews** – store reviews with ratings and visibility flags.
- **Lead collection** – record submissions from contact forms.
- **Dealership settings** – update contact information and other config.
- **Tasks & appointments** – track work, statuses, due dates, and assigned
  team members.
- **Announcements & FAQs** – publish updates and answer common questions.
- **CMS pages** – manage lightweight content pages with status control.
- **Automations, webhooks & integrations** – configure external connectivity
  and workflow automation.
- **Reporting & exports** – generate aggregate metrics and CSV exports.
- **Customers & trade-ins** – manage customer profiles, preferences, and appraisals.
- **Service & parts** – track service tickets, parts orders, and delivery logistics.
- **Finance & deals** – monitor finance applications and approvals.
- **Marketing & events** – run campaigns and coordinate events with KPIs.
- **Dashboard** – browse key operational metrics and activity from the built‑in
  admin dashboard (`/dashboard.html`).

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

3. **Start the server.**  The default port is `3000`, but you can set
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

| Method | Endpoint                     | Purpose                                                 |
|-------:|------------------------------|---------------------------------------------------------|
|  GET   | `/inventory`                 | List inventory with filters and spotlight flag          |
|  GET   | `/inventory/:id`             | Retrieve a single unit by ID                            |
|  POST  | `/inventory`                 | Create a new unit                                       |
|  PUT   | `/inventory/:id`             | Update an existing unit                                 |
|  DELETE| `/inventory/:id`             | Delete a unit                                           |
|  GET   | `/teams`                     | List all staff teams                                    |
|  GET   | `/teams/:id`                 | Retrieve a team by ID                                   |
|  POST  | `/teams`                     | Create a new team                                       |
|  PUT   | `/teams/:id`                 | Update a team                                           |
|  DELETE| `/teams/:id`                 | Delete a team                                           |
|  GET   | `/reviews`                   | List all reviews                                        |
|  GET   | `/reviews/:id`               | Retrieve a review by ID                                 |
|  POST  | `/reviews`                   | Add a new review                                        |
|  PUT   | `/reviews/:id`               | Update a review                                         |
|  DELETE| `/reviews/:id`               | Delete a review                                         |
|  GET   | `/leads`                     | List all leads                                          |
|  GET   | `/leads/:id`                 | Retrieve a lead by ID                                   |
|  POST  | `/leads`                     | Record a new lead submission                            |
|  PUT   | `/leads/:id`                 | Update a lead                                           |
|  DELETE| `/leads/:id`                 | Delete a lead                                           |
|  GET   | `/customers`                 | List customers with search and segments                 |
|  POST  | `/customers`                 | Create a customer profile                               |
|  PUT   | `/customers/:id`             | Update a customer                                       |
|  DELETE| `/customers/:id`             | Delete a customer                                       |
|  GET   | `/trade-ins`                 | List trade-in appraisals                                |
|  POST  | `/trade-ins`                 | Create a trade-in record                                |
|  PUT   | `/trade-ins/:id`             | Update a trade-in                                       |
|  GET   | `/finance-applications`      | List finance applications                               |
|  POST  | `/finance-applications`      | Submit a finance application                            |
|  PUT   | `/finance-applications/:id`  | Update a finance application                            |
|  GET   | `/service-tickets`           | List service tickets                                    |
|  POST  | `/service-tickets`           | Open a new service ticket                               |
|  PUT   | `/service-tickets/:id`       | Update a service ticket                                 |
|  PATCH | `/service-tickets/:id/status`| Change service ticket status                            |
|  GET   | `/deliveries`                | List deliveries and statuses                            |
|  POST  | `/deliveries`                | Schedule a delivery                                     |
|  PUT   | `/deliveries/:id`            | Update a delivery                                       |
|  GET   | `/campaigns`                 | List marketing campaigns                                |
|  POST  | `/campaigns`                 | Create a campaign                                       |
|  PUT   | `/campaigns/:id`             | Update a campaign                                       |
|  GET   | `/events`                    | List dealership events                                  |
|  POST  | `/events`                    | Create an event                                         |
|  PUT   | `/events/:id`                | Update an event                                         |
|  GET   | `/parts-orders`              | List parts orders                                       |
|  POST  | `/parts-orders`              | Place a parts order                                     |
|  PUT   | `/parts-orders/:id`          | Update a parts order                                    |
|  GET   | `/inventory-audits`          | List inventory audit records                            |
|  POST  | `/inventory-audits`          | Log an inventory audit                                  |
|  GET   | `/tasks`                     | List tasks with filtering and sorting                   |
|  POST  | `/tasks`                     | Create a new task                                       |
|  PUT   | `/tasks/:id`                 | Update task status and details                          |
|  DELETE| `/tasks/:id`                 | Delete a task                                           |
|  GET   | `/appointments`              | List appointments                                       |
|  POST  | `/appointments`              | Create an appointment                                   |
|  PUT   | `/appointments/:id`          | Update an appointment                                   |
|  DELETE| `/appointments/:id`          | Delete an appointment                                   |
|  GET   | `/announcements`             | List announcements                                      |
|  POST  | `/announcements`             | Create a new announcement                               |
|  PUT   | `/announcements/:id`         | Update an announcement                                  |
|  DELETE| `/announcements/:id`         | Delete an announcement                                  |
|  GET   | `/pages`                     | List CMS pages                                          |
|  POST  | `/pages`                     | Create a CMS page                                       |
|  PUT   | `/pages/:id`                 | Update a CMS page                                       |
|  DELETE| `/pages/:id`                 | Delete a CMS page                                       |
|  GET   | `/faqs`                      | List FAQs                                               |
|  POST  | `/faqs`                      | Create a FAQ                                            |
|  PUT   | `/faqs/:id`                  | Update a FAQ                                            |
|  DELETE| `/faqs/:id`                  | Delete a FAQ                                            |
|  GET   | `/webhooks`                  | List webhooks                                           |
|  POST  | `/webhooks`                  | Create a webhook                                        |
|  PUT   | `/webhooks/:id`              | Update a webhook                                        |
|  PATCH | `/webhooks/:id/toggle`       | Toggle webhook state                                    |
|  GET   | `/automations`               | List automations                                        |
|  POST  | `/automations`               | Create an automation                                    |
|  PUT   | `/automations/:id`           | Update an automation                                    |
|  PATCH | `/automations/:id/status`    | Change automation status                                |
|  GET   | `/integrations`              | List integrations                                       |
|  PUT   | `/integrations/:id`          | Update integration status                               |
|  GET   | `/reports/overview`          | Get aggregated reporting metrics                        |
|  GET   | `/exports/:resource`         | Export inventory, leads, or tasks as CSV                |
|  GET   | `/dashboard/summary`         | Summary metrics for dashboard                           |
|  GET   | `/dashboard/insights`        | Dashboard insights and activity                         |
|  GET   | `/dashboard/operations`      | Operational SLA and productivity view                   |
|  GET   | `/dashboard/control-center`  | Feature flags, automations, and integrations overview   |
|  GET   | `/activity`                  | Recent activity feed                                    |
|  GET   | `/settings`                  | Retrieve dealership settings                            |
|  PUT   | `/settings`                  | Update dealership settings                              |

### Persisting data

By default the backend uses the JSON files under `data/` as a simple
persistent store.  When you modify or add new records, the data is
written back to disk.  For production use you should replace this
mechanism with a proper database.  See the functions `loadData()` and
`saveData()` in `index.js` for where to plug in your own persistence
layer.

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

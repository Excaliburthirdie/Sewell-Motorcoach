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

| Method | Endpoint         | Purpose                                     |
|-------:|------------------|---------------------------------------------|
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
|  GET   | `/leads`         | List all leads                              |
|  GET   | `/leads/:id`     | Retrieve a lead by ID                       |
|  POST  | `/leads`         | Record a new lead submission                |
|  PUT   | `/leads/:id`     | Update a lead                               |
|  DELETE| `/leads/:id`     | Delete a lead                               |
|  GET   | `/settings`      | Retrieve dealership settings                |
|  PUT   | `/settings`      | Update dealership settings                  |

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
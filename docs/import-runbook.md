# Bulk inventory import runbook

This runbook explains how to load inventory units in bulk using the `/v1/inventory/import` endpoint. It covers the expected CSV layout, how to authenticate, and what to check when rows fail validation.

## Prerequisites

- An authenticated user with `admin` or `sales` role.
- A CSRF token cookie and header (obtainable via `GET /v1/health`).
- Tenant context provided via the `X-Tenant-Id` header or `tenantId` field. The tenant passed in the request scopes all created units.

## CSV layout

The first line must be a header row. Supported columns (case-sensitive) are:

- **Required:** `stockNumber`, `vin`, `name`, `condition`, `price`
- **Pricing extras:** `msrp`, `salePrice`, `rebates`, `fees`, `taxes`
- **Specs:** `year`, `length`, `weight`, `chassis`, `industry`, `category`, `subcategory`, `location`, `lotCode`, `transferStatus`, `holdUntil`
- **Web content:** `description`, `slug`, `metaTitle`, `metaDescription`
- **Media:** `images`, `floorplans`, `virtualTours`, `videoLinks` (pipe-delimited: `https://a.jpg|https://b.jpg`)
- **Flags:** `featured` (true/false)

Aliases are accepted for a few fields: `stock_number`, `sale_price`, `lot_code`, `transfer_status`, `hold_until`, `meta_title`, `meta_description`, and `virtual_tours`.

### Example CSV

```
stockNumber,vin,name,condition,price,fees,rebates,images,floorplans,virtualTours,videoLinks,holdUntil,year,length,weight,chassis,description,metaTitle,metaDescription
STK-9,VIN-999,Flagship,new,200000,500,1000,https://ex.com/a.jpg|https://ex.com/b.jpg,https://ex.com/fp.pdf,https://ex.com/vr,https://ex.com/vid,2024-01-01,2024,40,15000,Spartan,Premium coach,Great title,Meta description
```

## Execution steps

1. **Fetch CSRF token**
   ```sh
   curl -i http://localhost:3000/v1/health
   ```
   Copy the `csrfToken` cookie and `x-csrf-token` header values.
2. **Authenticate** to obtain an access token (and optionally refresh token) using `POST /v1/auth/login`.
3. **Invoke the import**
   ```sh
   curl -X POST http://localhost:3000/v1/inventory/import \
     -H "Authorization: Bearer <accessToken>" \
     -H "X-CSRF-Token: <csrfToken>" \
     -H "Cookie: csrfToken=<csrfToken>" \
     -H "X-Tenant-Id: main" \
     -H "Content-Type: application/json" \
     -d @- <<'JSON'
   {"csv": "$(cat inventory.csv | sed ':a;N;$!ba;s/\n/\\n/g')"}
   JSON
   ```
   The response status is `201` when all rows succeed or `207` when some rows contain validation errors. The body includes `created` units and an `errors` array describing any rejected rows.

## Troubleshooting

- **CSV payload is empty or malformed**: ensure the request body contains a `csv` string with at least one data row and that each row has the same number of columns as the header.
- **Validation failures**: check that `condition` is one of `new`, `used`, `demo`, or `pending_sale`; `transferStatus` is a supported value; URLs are valid; and numbers are formatted without currency symbols.
- **VIN or slug conflicts**: the import enforces per-tenant uniqueness. Correct duplicates or provide unique `slug` values to avoid conflicts.
- **Media not splitting**: separate multiple URLs with the pipe (`|`) character. Commas split columns and cannot be used inside a URL without quoting the entire CSV cell.
- **Date parsing**: `holdUntil` must be an ISO-8601 date (e.g., `2024-01-01`). Invalid dates are discarded during import.

Following these steps keeps bulk imports consistent with the validation and derived data used by the API.

# Insight & Merchandising Follow-ups

- Swap the inline PDF string builder for a production PDF template library (e.g., pdfkit) so proposal summaries match dealer
  branding, include logos, and can be regenerated from stored metadata.
- Add postal-code geocoding fallback for Local Demand when latitude/longitude are missing and cache geo lookups per tenant to
  avoid redundant API calls.
- Add filters (channel, campaign, date range) to the Deep Attribution endpoint plus optional model weights to experiment with
  W-shaped or time-decay attribution models.

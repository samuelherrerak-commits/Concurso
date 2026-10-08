# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/vanilla JS (no build step), hosted on GitHub Pages or Netlify. Backend: Google Apps Script Web App with Google Sheets as the database. Both pinned by the brief.

## Users

Prosein sales staff in Venezuela (showrooms and franchises), mostly on their phones between customers, loading invoices right after a sale. Secondary user: the contest coordinator, who works in the Google Sheet (approves invoices, runs weekly winners and the final draw).

## Product Purpose

Run "Copa Prosein", an internal sales contest. Sellers register sales (day, invoice number, amount, invoice photo, optional Austral m²) and see their record and raffle coupons. Goal: sell as much as possible, and push Austral products.

## Capabilities and Constraints

- 1 coupon per $1,500 accumulated (configurable). Leftover carries over.
- Weekly prizes: 6 sellers who complete the most coupons that week (leftover carries across weeks; week is set by sale date).
- Grand prize (all-inclusive trip for two): most Austral m² over the whole contest. Tie-break: total sales amount.
- Final raffle mechanics: **undecided**. Coupons are numbered and exported; the draw logic is meant to be adjusted later.
- Login: cédula + password chosen by the seller. Password reset is done by the admin clearing the hash in the sheet.
- Invoices are unique across all sellers. Rejected invoices can be re-submitted.
- Counting mode (immediate vs. approved-only) is configurable; the owner chose immediate.

## Brand Commitments

- Prosein brand red `#DF1630` and text charcoal `#303133` (from prosein.com.ve), Poppins as the brand UI font, white/`#F7F7F7` grounds. Logo: white "PROSEIN" wordmark on red square.
- Minimalist.
- Signature moment requested by the owner: a coupon printed as a supermarket receipt when a sale completes one.
- All UI copy in Venezuelan Spanish (tú).

## Product Principles

1. The seller's phone is the main device: thumb-reachable action, fast loads, camera-first photo.
2. Numbers must be trustworthy: everything recalculates from the sheet, never from stored counters.
3. Celebrate the coupon, keep everything else quiet.
4. The coordinator never edits code: every rule lives in the Configuracion sheet.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/vanilla JS (no build step), hosted on GitHub Pages or Netlify. Backend: Google Apps Script Web App with Google Sheets as the database. Both pinned by the brief.

## Users

Prosein sales staff in Venezuela (showrooms and franchises), mostly on their phones between customers, loading invoices right after a sale. Secondary user: the contest coordinator (role `admin`, added by hand in the Usuarios sheet). They approve invoices in the Google Sheet and use a read-only admin view in the portal to audit sellers, sales, rounds and draw bags, and to print the raffle coupons.

## Product Purpose

Run "Copa Navideña Austral - Prosein", an internal sales contest. Sellers register sales (day, invoice number, amount, invoice photo, optional Austral m² or pieces) and see their coupons per round, goal progress (informative), final-draw coupons and Austral coupons. Swipeable welcome cards explain the Copa the first time the app opens. They can reopen and download any coupon they won. Goal: sell as much as possible, and push Austral products.

## Capabilities and Constraints

- Campaign name: "Copa Navideña Austral - Prosein" (end of 2026). "Austral" is always shown in Austral blue `#0B5CD5` (on red grounds, inside a white plate). The earlier name "La bolsa de los deseos" is retired.
- Sales channels: Tiendas (one of the Prosein stores), Distribuidores, Corporativo. Each store and channel has its own coupon value and sales goal (Canales sheet).
- 1 coupon per coupon value accumulated. Leftover carries over.
- Rounds (Rondas sheet): Ronda 1 (15/10–5/11, draw Mon 9/11), Ronda 2 (6/11–26/11, draw 30/11), Ronda 3 (27/11–10/12, draw 14/12), La Ñapa (11/12–19/12, no draw). Each round's draw uses only coupons completed in that round. Cut: the day after the round ends, 3:00 p.m.
- A sale belongs to the round in which it is registered; each round closes at the end of its last day.
- Gran Sorteo Final (Mon 21/12): 1 final coupon per 10 accumulated coupons (no goal requirement), plus 1 coupon per 80 m² or pieces of Austral (500 for Distribuidores), plus 1 coupon for the top seller (amount) of each channel in each round with a draw.
- Login: cédula + password chosen by the seller. Password reset is done by the admin clearing the hash in the sheet.
- Invoices are unique across all sellers. Rejected invoices can be re-submitted.
- Admin is read-only in the portal; every rule, date, coupon value and goal lives in the sheet. Admin prints coupons for each draw bag.

## Brand Commitments

- Prosein brand red `#DF1630` and text charcoal `#303133` (from prosein.com.ve), Poppins as the brand UI font, white/`#F7F7F7` grounds. Logo: white "PROSEIN" wordmark on red square. Campaign mark: the red shopping bag from the "Navidad en Grande" artwork (`web/assets/bolsa.svg` in white for red grounds, `bolsa-roja.svg` and the app icon in red on `#F7F7F7`).
- Minimalist.
- Signature moment requested by the owner: a coupon printed as a supermarket receipt when a sale completes one. Austral tickets are the same receipt in blue ink.
- All UI copy in Venezuelan Spanish (tú).

## Product Principles

1. The seller's phone is the main device: thumb-reachable action, fast loads, camera-first photo.
2. Numbers must be trustworthy: everything recalculates from the sheet, never from stored counters.
3. Celebrate the coupon, keep everything else quiet.
4. The coordinator never edits code: every rule lives in the Configuracion sheet.

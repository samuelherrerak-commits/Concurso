# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/vanilla JS (no build step), hosted on GitHub Pages or Netlify. Backend: Google Apps Script Web App with Google Sheets as the database. Both pinned by the brief.

## Users

Prosein sales staff in Venezuela (showrooms and franchises), mostly on their phones between customers, loading invoices right after a sale. Secondary user: the contest coordinator (role `admin`, added by hand in the Usuarios sheet). They approve invoices in the Google Sheet and use a read-only admin view in the portal to audit sellers, sales, weeks and ballot boxes, and to print the raffle coupons.

## Product Purpose

Run "Copa Prosein", an internal sales contest. Sellers register sales (day, invoice number, amount, invoice photo, optional Austral m²) and see their record, category, raffle coupons and trip coupons. They can reopen and download any coupon they won. Goal: sell as much as possible, and push Austral products.

## Capabilities and Constraints

- 1 coupon per $1,500 accumulated (configurable). Leftover carries over.
- Weeks are configurable in a Periodos sheet. Default: 10 weeks from Thursday 15/10/2026, Thursday to Wednesday; cut Thursday 3:00 p.m.; prizes Friday morning. Closed weeks no longer accept sales.
- Weekly prizes: 6 sellers who complete the most coupons that week (leftover carries across weeks; week is set by sale date).
- Three categories at the final cut (default Oro 20 % / Plata 30 % / Bronce rest by coupon rank, ties move up; or by minimum coupons). Each category raffles its own prizes among its own coupons: 2 / 1 / 1.
- All-inclusive trip: every 100 m² of Austral is 1 trip coupon. Only the top category's trip coupons go into the trip ballot box.
- Store (one of the 9 Prosein stores) is required at sign-up; old accounts pick it on next login.
- Login: cédula + password chosen by the seller. Password reset is done by the admin clearing the hash in the sheet.
- Invoices are unique across all sellers. Rejected invoices can be re-submitted.
- Counting mode (immediate vs. approved-only) is configurable; the owner chose immediate.
- Admin is read-only in the portal; every rule and date lives in the sheet.

## Brand Commitments

- Prosein brand red `#DF1630` and text charcoal `#303133` (from prosein.com.ve), Poppins as the brand UI font, white/`#F7F7F7` grounds. Logo: white "PROSEIN" wordmark on red square.
- Minimalist.
- Signature moment requested by the owner: a coupon printed as a supermarket receipt when a sale completes one. Trip coupons are the same receipt in blue ink.
- All UI copy in Venezuelan Spanish (tú).

## Product Principles

1. The seller's phone is the main device: thumb-reachable action, fast loads, camera-first photo.
2. Numbers must be trustworthy: everything recalculates from the sheet, never from stored counters.
3. Celebrate the coupon, keep everything else quiet.
4. The coordinator never edits code: every rule lives in the Configuracion sheet.

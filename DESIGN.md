# Design

Visual system of the Copa Navideña Austral - Prosein portal, as built. Tokens live in `web/styles.css` `:root`.

## World

Prosein's own identity (red shell, charcoal ink, Poppins) plus one signature: **thermal paper**. Everything that is a coupon is paper: the account summary is a receipt, coupons are mini tickets, and a new coupon is printed by a receipt printer. Forms, lists and ranking stay plain Poppins UI. Light theme only: sellers use it in bright showrooms.

## Color

| Token | Value | Use |
|---|---|---|
| `--rojo` | `#DF1630` | Brand shell (headers), primary actions, progress fill, stamp ink, prize positions |
| `--rojo-hondo` | `#B70F25` | Hover/pressed, red text on light |
| `--carbon` / `--tinta` | `#141618` / `#303133` | Headings / body |
| `--tinta-2` / `--tinta-3` | `#5C5F63` / `#707377` | Secondary text / placeholders (AA on white) |
| `--fondo` / `--linea` | `#F7F7F7` / `#E4E4E4` | Ground / hairlines (from prosein.com.ve) |
| `--papel` / `--papel-tinta` | `#FFFDF6` / `#2A2926` | Thermal paper |
| `--austral` | `#0B5CD5` | Austral m², Austral tickets (ink, stamp, progress), toggle, leader badge |
| `--ok` `--espera` `--error` | green / amber / deep red | Invoice states (Aprobada / Pendiente / Rechazada) |

## Type

- **Poppins** 400/500/600/700: all UI. Body 15px, inputs 16px (no iOS zoom), headings 18–32px.
- **Archivo 800 at 115% width**: only the AUSTRAL - PROSEIN wordmark and the "Copa Navideña" display title (closest match to the logo lettering). Loaded as a text subset.
- **Chivo Mono** 400/700: paper only (receipt summary, tickets, mini tickets).
- Tabular numerals everywhere.

## Components

- Paper: CSS conic-gradient mask for zigzag edges, `drop-shadow` on a wrapper.
- Stamp: double red border, -7° rotation, multiply blend, SVG-noise mask for rubber-ink texture.
- Bottom sheet on mobile (registrar venta), centered dialog from 720px.
- Fixed bottom action bar on mobile; inline in the left column from 960px.
- Desktop: two columns (summary + coupons + Austral ticket sticky on the left; sales table + ranking on the right).
- Mini tickets are buttons: tap opens the coupon viewer (same ticket, no printing, stamp already on) with "Descargar imagen" (canvas PNG at 3×, same rows as the on-screen ticket) and "Compartir" where the Web Share API takes files.
- Austral coupons section: blue progress toward the next coupon (80 m² or pieces; 500 for Distribuidores), blue mini tickets.
- Welcome cards (`#dlg-intro`, `web/js/copa.js`): full-screen red dialog, white rounded cards in a horizontal scroll-snap track, dots and Saltar / Siguiente / ¡Empezar!. Shown once per device; reopened from "¿Cómo funciona la Copa?". Rules A–J use red letter badges.
- Store picker: native `<select>` with a chevron; bottom sheet for old accounts without a store.
- Receipt summary: total coupons, the current round's coupons, next-coupon progress, and a "Gran Sorteo Final" block with a goal bar (charcoal fill, red tick at the required %).
- Mini tickets carry their round name (RONDA 1, LA ÑAPA) instead of "CUPÓN"; the ticket header is "AUSTRAL - PROSEIN" (AUSTRAL in blue, PROSEIN in red), the subtitle "COPA NAVIDEÑA", with a RONDA row.
- Admin view: same red shell with an "Administración" pill, a white tab bar (selected tab in charcoal), plain tables in scroll containers, a hairline grid of figures. Draw cards: Ronda 1–3 plain, Gran Sorteo Final with a red band, Austral ticket with a black band, matching their printed slips.
- Printable coupons (`cupones.html` + `imprimir.css`): Letter, 8 mm margin, 3 × 8 grid of 66 × 31.8 mm slips with dashed cut lines, one draw bag per page run. Regular slips: wordmark + red rule + red code. Final-draw slips: red band "GRAN SORTEO FINAL". Austral coupons (inside the final bag): black band "CUPÓN AUSTRAL" (print-color-adjust exact) and a black code. Best-seller coupons: gold band "MEJOR VENDEDOR".

## Motion

Curves: `--ease-out cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out cubic-bezier(0.77,0,0.175,1)`, `--ease-drawer cubic-bezier(0.32,0.72,0,1)`.

- Buttons: `scale(0.97)` on press, 160ms. Hover only with `(hover: hover) and (pointer: fine)`.
- Sheet 450ms drawer curve. Dialogs and menu 180–250ms. Toasts use transitions (interruptible).
- **Printer (the one authored moment):** a sale that completes regular and Austral tickets runs two passes: red tickets first, then the blue Austral ticket ticket with its own counter. Each pass: printer drops in 250ms → paper feeds line by line (staircase keyframes, ease-out per line, ~760ms for one ticket) → paper settles 7px on cut → stamp lands with scale 1.7→0.94→1 and rotation → counter counts up, progress bar fills to 100%, resets, fills to the new leftover. Several coupons stack with an offset, ≤4 tickets on screen, about 2.5s total. Only transform and opacity animate.
- Coupon viewer: 200 ms fade and a 10 px rise of the ticket, blurred backdrop.
- `prefers-reduced-motion`: no printing or rotation; the finished ticket fades in.

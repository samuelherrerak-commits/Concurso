# Design

Visual system of the Copa Prosein portal, as built. Tokens live in `web/styles.css` `:root`.

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
| `--austral` | `#0B5CD5` | Austral m², trip coupons (ink, stamp, progress), toggle, leader badge |
| `--ok` `--espera` `--error` | green / amber / deep red | Invoice states (Aprobada / Pendiente / Rechazada) |

## Type

- **Poppins** 400/500/600/700: all UI. Body 15px, inputs 16px (no iOS zoom), headings 18–32px.
- **Archivo 800 at 115% width**: only the PROSEIN wordmark and the "Copa Prosein" display title (closest match to the logo lettering). Loaded as a text subset.
- **Chivo Mono** 400/700: paper only (receipt summary, tickets, mini tickets).
- Tabular numerals everywhere.

## Components

- Paper: CSS conic-gradient mask for zigzag edges, `drop-shadow` on a wrapper.
- Stamp: double red border, -7° rotation, multiply blend, SVG-noise mask for rubber-ink texture.
- Bottom sheet on mobile (registrar venta), centered dialog from 720px.
- Fixed bottom action bar on mobile; inline in the left column from 960px.
- Desktop: two columns (summary + coupons + trip sticky on the left; sales table + ranking on the right).
- Mini tickets are buttons: tap opens the coupon viewer (same ticket, no printing, stamp already on) with "Descargar imagen" (canvas PNG at 3×, same rows as the on-screen ticket) and "Compartir" where the Web Share API takes files.
- Trip section: blue progress toward the next 100 m², blue mini tickets, one line saying whether the seller's current category enters the trip draw.
- Store picker: native `<select>` with a chevron; bottom sheet for old accounts without a store.
- Admin view: same red shell with an "Administración" pill, a white tab bar (selected tab in charcoal), plain tables in scroll containers, a hairline grid of figures. The trip ballot box card carries the same black band as its printed slips.
- Printable coupons (`cupones.html` + `imprimir.css`): Letter, 8 mm margin, 3 × 8 grid of 66 × 31.8 mm slips with dashed cut lines, one ballot box per page run. Regular slips: wordmark + red rule + red code. Trip slips: black band "VIAJE TODO INCLUIDO" (print-color-adjust exact) and a black code.

## Motion

Curves: `--ease-out cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out cubic-bezier(0.77,0,0.175,1)`, `--ease-drawer cubic-bezier(0.32,0.72,0,1)`.

- Buttons: `scale(0.97)` on press, 160ms. Hover only with `(hover: hover) and (pointer: fine)`.
- Sheet 450ms drawer curve. Dialogs and menu 180–250ms. Toasts use transitions (interruptible).
- **Printer (the one authored moment):** a sale that completes regular and trip coupons runs two passes: red tickets first, then the blue trip ticket with its own counter. Each pass: printer drops in 250ms → paper feeds line by line (staircase keyframes, ease-out per line, ~760ms for one ticket) → paper settles 7px on cut → stamp lands with scale 1.7→0.94→1 and rotation → counter counts up, progress bar fills to 100%, resets, fills to the new leftover. Several coupons stack with an offset, ≤4 tickets on screen, about 2.5s total. Only transform and opacity animate.
- Coupon viewer: 200 ms fade and a 10 px rise of the ticket, blurred backdrop.
- `prefers-reduced-motion`: no printing or rotation; the finished ticket fades in.

# Rare Luxe — Booking Types, Events & Follow-up Upgrade

This upgrade adds an **Events** booking type alongside the existing **Rent Out**
type, gives events critical visibility on the Dashboard and Calendar, adds a
**Follow-up** page for yearly repeat-order outreach, moves Supabase credentials
into environment variables, and adds Vercel deployment config.

## 1. What changed

### Booking Types
- Every booking now has a `booking_type`: `rent_out` (default, all existing
  behavior unchanged) or `event` (new).
- The New/Edit Booking form has a **Booking Type** selector (Rent Out / Event)
  at the top — everything else about the form (items, pricing, payment,
  status, WhatsApp invoice, etc.) works identically for both types.
- Bookings, Clients and Calendar views show a small type badge — gold
  "📦 RENT OUT" or **critical red** "🎉 EVENT" — so the type is visible at a
  glance everywhere a booking appears.

### Dashboard
- A new highlighted red **"Upcoming Events — [Month]"** card sits right below
  the stat tiles, listing every Event booked for the current calendar month
  (event name, client, date, status, total). Tapping one jumps straight to
  that booking. If nothing's booked yet, it says so — the section is always
  visible, not just when there's something to show.

### Calendar
- Any date with an Event gets a **critical red** cell (month view) or day
  card (week view) — this always wins visually over "today" / "selected"
  highlighting, so an event is never visually lost.
- A small legend ("● = Event") is shown under the Calendar header.
- Individual booking entries in the day/week detail lists also carry the red
  type badge when they're events.

### Follow-up (new page)
- New tab: **Follow-up** (☎), between Calendar and Inventory.
- Defaults to the current month and queries Supabase directly for **all
  Events from that month, one year ago** — e.g. in September 2026 it shows
  September 2025's events by default — so staff can proactively call clients
  about the annual event coming back around.
- A month picker lets staff check any other month of last year too.
- Each result shows: event name, client name, phone, email, and the original
  event date, plus one-tap **📞 Call** (`tel:`) and **📲 WhatsApp** buttons
  (a friendly repeat-order reminder message, distinct from the invoice
  message used elsewhere in the app).

### Export
- The Excel export now includes a **Booking Type** column (Event / Rent Out).

### Environment & Deployment
- Supabase URL/anon key are no longer hardcoded in `supabaseClient.js` or
  `src/App.jsx`. Both now read `import.meta.env.VITE_SUPABASE_URL` and
  `import.meta.env.VITE_SUPABASE_ANON_KEY`.
- `.env` is included in this zip with your **existing** project's values
  (carried over from the original `supabaseClient.js`), so the app works
  out of the box locally. `.env` is git-ignored — set the same two variables
  in your Vercel project's **Settings → Environment Variables** for
  Preview/Production deployments (they won't be picked up from a local
  `.env` file that isn't committed).
- Added `vercel.json` (none existed before) so `vercel` / the Vercel dashboard
  builds this as a Vite SPA and routes all paths to `index.html`.

## 2. Database migration (required)

Run `supabase/migration.sql` once in your Supabase project's SQL Editor. It:

1. Adds `booking_type text not null default 'rent_out'` to `bookings`
   (existing rows are automatically treated as Rent Out — no data loss).
2. Adds a check constraint restricting it to `'rent_out' | 'event'`.
3. Adds indexes on `booking_type` and `date` for fast dashboard/calendar/
   follow-up filtering.
4. Creates two convenience views: `v_upcoming_events_this_month` and
   `v_followup_last_year_events`, mirroring the same filters the app itself
   uses (useful if you want to check the numbers directly in Supabase, or
   build a report on top of them later).

The app's own dashboard/calendar/follow-up queries filter by `booking_type`
directly (client-side for dashboard/calendar, since all bookings are already
loaded; a dedicated Supabase REST query for Follow-up, since that's a new,
separate lookup by month/year) — the SQL views are there for convenience /
reporting, not a hard dependency for the UI to work.

## 3. Environment setup

```bash
# .env is already included with your existing project's values — nothing to
# do locally. If you ever need to point at a different Supabase project:
cp .env.example .env
# then edit VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

## 4. Deploying to Vercel

1. Push this project to a git repo (GitHub/GitLab/Bitbucket) — `.env` will
   correctly be excluded by `.gitignore`.
2. In Vercel: **New Project** → import the repo → framework auto-detects as
   Vite (confirmed by `vercel.json`).
3. Add the two environment variables from `.env` under
   **Settings → Environment Variables** (Production *and* Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. `vercel.json` handles the SPA rewrite so refreshing any route
   (e.g. `/bookings`) doesn't 404.

## 5. Nothing else changed

Authentication, Inventory, Clients, Export, WhatsApp invoices, downloadable
invoices, and every existing Rent Out workflow are untouched — Events are a
strict addition on top of the existing data model and UI.


---

# Update 2 — Discount & totals fix, view-only demo login

## Booking form: Subtotal → Discount → Total Amount
- **Bug fixed:** the old Total Amount box recalculated inside another state
  update and lagged one step behind the items (e.g. showed ₹2,000 while the
  items subtotal was ₹3,500). Totals are now calculated directly from the items
  every render, so they can never go out of sync.
- The money section now sits at the **bottom of the form**, after the items:
  1. **Subtotal (all items)** – automatic, sum of qty × rate.
  2. **Discount (₹)** – typed by staff (capped at the subtotal).
  3. **Total Amount** – automatic = Subtotal − Discount.
  4. **Advance Paid** and **Balance Due** (Balance = Total − Advance).
- If no item rates were entered (or on older bookings whose saved total was
  higher than their items), a manual Subtotal box appears instead.
- Saved as `total` (final amount, same meaning as before) + new `discount`
  column. Balance, revenue, dashboard and invoices keep using `total`.
- Booking details, WhatsApp invoice, downloadable invoice and Excel export now
  show Subtotal and Discount when a discount was given.
- Older bookings: any gap between their items subtotal and saved total is shown
  as the discount when opened for edit; saved totals are never changed unless
  you edit and save that booking.

**Required:** run `supabase/discount_migration.sql` once in the Supabase SQL
editor (adds `discount numeric not null default 0`). Do this before deploying.

## View-only demo login
1. Supabase Dashboard → Authentication → Users → **Add user** (tick auto-confirm)
   with email `demo@rareluxe.com` and a password you choose.
   (Use another email? set `VITE_DEMO_EMAIL` in `.env` and in Vercel.)
2. Log in with it: every add / edit / delete / status / mark-paid control is
   hidden, a "DEMO · VIEW ONLY" label and banner are shown, and each write
   function also refuses to run. Viewing, calendar, follow-up, WhatsApp/invoice
   sharing and Export still work.
3. Note: this restricts the app's screens. The app talks to Supabase with the
   public anon key, so it is not a database-level lock. Fine for presenting
   yourself; don't hand the demo login to strangers as a security boundary.

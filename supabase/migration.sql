-- ============================================================================
-- Rare Luxe — Booking Type (Rent Out / Events) migration
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- against the same project referenced in your .env file.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- NOTE: bookings.date is stored as TEXT (ISO "YYYY-MM-DD" strings), not a
-- native Postgres `date` column — that's how the app writes it via the REST
-- API. Every comparison below explicitly casts it with `date::date` so it
-- can be compared against real date values. If you ever migrate that column
-- to a native `date` type, these casts are harmless no-ops and can stay.
-- ============================================================================

-- 1. Add the booking_type column to the existing bookings table.
--    Defaults every existing row to 'rent_out' so current bookings keep
--    working exactly as before with zero manual data migration.
alter table public.bookings
  add column if not exists booking_type text not null default 'rent_out';

-- 2. Constrain it to the two supported values.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_booking_type_check'
  ) then
    alter table public.bookings
      add constraint bookings_booking_type_check
      check (booking_type in ('rent_out', 'event'));
  end if;
end $$;

-- 3. Helpful indexes for the dashboard / calendar / follow-up queries, which
--    all filter by booking_type and/or date.
create index if not exists idx_bookings_booking_type on public.bookings (booking_type);
create index if not exists idx_bookings_date on public.bookings (date);
create index if not exists idx_bookings_type_date on public.bookings (booking_type, date);

-- ============================================================================
-- Views
-- ============================================================================

-- 4. Dashboard: all Events booked for the current calendar month.
--    (The app also computes this client-side from already-loaded bookings;
--    this view is provided so the same figure can be checked directly from
--    the Supabase SQL editor, in a Supabase report, or from another tool.)
create or replace view public.v_upcoming_events_this_month as
select *
from public.bookings
where booking_type = 'event'
  and (date)::date >= date_trunc('month', current_date)::date
  and (date)::date <  (date_trunc('month', current_date) + interval '1 month')::date
order by (date)::date asc;

-- 5. Follow-up page: last year's events for the CURRENT month (today's month,
--    one year back) — i.e. clients whose event is due to recur again soon,
--    so staff know who to call about a repeat booking.
--    The app itself queries any month the user picks from the Follow-up
--    page's month selector directly via the REST API; this view mirrors
--    the *default* (current month) case for ad-hoc use in Supabase.
create or replace view public.v_followup_last_year_events as
select
  id,
  booking_type,
  event        as event_name,
  customer     as client_name,
  phone        as client_phone,
  email        as client_email,
  date         as event_date,
  status,
  total,
  advance
from public.bookings
where booking_type = 'event'
  and (date)::date >= (date_trunc('month', current_date) - interval '1 year')::date
  and (date)::date <  (date_trunc('month', current_date) + interval '1 month' - interval '1 year')::date
order by (date)::date asc;

-- ============================================================================
-- Notes
-- ============================================================================
-- • If any existing row has a non-ISO or blank `date` value, the ::date cast
--   in the views above will throw when the view is *queried* (views aren't
--   validated row-by-row at creation time). Find/fix any bad rows with:
--     select id, date from public.bookings where date !~ '^\d{4}-\d{2}-\d{2}$';
-- • These views inherit the bookings table's Row Level Security policies (if
--   any are enabled) — no separate grants are required for the anon/authenticated
--   roles beyond what already applies to `bookings`.
-- • The Follow-up page in the app queries Supabase directly for the selected
--   month with:
--     bookings?booking_type=eq.event&date=gte.<start>&date=lte.<end>&order=date.asc
--   This is a plain text range comparison done by PostgREST, which works
--   correctly here because the dates are zero-padded ISO strings (lexical
--   order matches chronological order) — no cast is needed for that
--   REST-side query, only for the SQL views above.

-- ============================================================================
-- 6. Discount column (also available standalone as supabase/discount_migration.sql)
-- ============================================================================
alter table public.bookings
  add column if not exists discount numeric not null default 0;

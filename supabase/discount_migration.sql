-- ============================================================================
-- Rare Luxe — Discount column migration
-- Run ONCE in the Supabase SQL editor BEFORE using the new booking form.
-- Safe to re-run. Does not touch or delete any existing booking data.
-- ============================================================================

-- Existing bookings get discount = 0, so their saved totals stay exactly as-is.
alter table public.bookings
  add column if not exists discount numeric not null default 0;

-- How the numbers fit together (the app saves these two columns):
--   total    = Subtotal (all items) - discount     <- final amount, unchanged meaning
--   discount = money taken off the subtotal
-- So Subtotal for any booking = total + discount, and balance due / revenue /
-- invoices keep working off `total` exactly like before.

-- Optional check:
-- select id, customer, total, discount, (total::numeric + discount) as subtotal
-- from public.bookings order by id desc limit 10;

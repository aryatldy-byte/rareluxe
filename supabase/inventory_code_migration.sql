-- ============================================================================
-- Rare Luxe — Inventory codes migration
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Why not just:  ALTER TABLE inventory ADD COLUMN code TEXT UNIQUE NOT NULL;
-- That exact statement FAILS if the table already has rows (existing rows would
-- get NULL, violating NOT NULL). So we add the column, give every existing row
-- a unique placeholder code (TMP-<id>), then enforce UNIQUE + NOT NULL.
-- If the table is empty, the end result is identical to your one-liner.
-- ============================================================================

-- 1. Add column (nullable for the moment)
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS code TEXT;

-- 2. Backfill placeholders for existing rows so NOT NULL can be applied
UPDATE public.inventory
SET code = 'TMP-' || id::text
WHERE code IS NULL OR btrim(code) = '';

-- 3. Normalise any existing codes to trimmed UPPERCASE
UPDATE public.inventory SET code = upper(btrim(code));

-- 4. Enforce NOT NULL
ALTER TABLE public.inventory ALTER COLUMN code SET NOT NULL;

-- 5. Enforce UNIQUE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_code_key') THEN
    ALTER TABLE public.inventory ADD CONSTRAINT inventory_code_key UNIQUE (code);
  END IF;
END $$;

-- 6. Enforce uppercase + non-empty at the database level (even for CSV imports / SQL edits)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_code_format_check') THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_code_format_check
      CHECK (btrim(code) <> '' AND code = upper(btrim(code)));
  END IF;
END $$;

-- ============================================================================
-- Filling in real codes for existing items via Excel/CSV
-- ============================================================================
-- a) In Excel make two columns:  name, code   → Save As CSV (UTF-8).
-- b) Create a staging table and import the CSV into it
--    (Table Editor → inventory_code_import → Insert → Import data from CSV):
--
--    CREATE TABLE IF NOT EXISTS public.inventory_code_import (name text, code text);
--
-- c) Apply the codes (matches on item name, case-insensitive; uppercases for you):
--
--    UPDATE public.inventory i
--    SET code = upper(btrim(s.code))
--    FROM public.inventory_code_import s
--    WHERE lower(btrim(i.name)) = lower(btrim(s.name))
--      AND btrim(coalesce(s.code, '')) <> '';
--
--    -- If two rows share a code the UPDATE aborts with a unique-violation: fix the CSV and re-run.
--
-- d) Clean up:   DROP TABLE public.inventory_code_import;
--
-- Items still showing a TMP-… code simply weren't in your CSV — edit them in the app.

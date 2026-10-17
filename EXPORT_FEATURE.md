# 🆕 Export Feature

A new **Export** tab has been added to the app's main navigation (alongside Home, Bookings, Calendar, Inventory, Clients).

## What it does

From the Export tab you can download an Excel (`.xlsx`) file containing:

- **What to export:** Bookings only, Inventory only, or Both (as separate sheets in one workbook)
- **Date range:**
  - **All Time** — every record
  - **Monthly** — pick a month (e.g. September 2026); bookings are filtered by their booking date
  - **Specific Date** — pick a single date; bookings on that exact date

Inventory is a live stock count rather than a dated log, so it always shows current stock levels. If your Supabase `inventory` table has a `created_at` column (added automatically by Supabase), inventory rows are additionally filtered by that "added on" date when you choose Monthly/Specific Date — otherwise all inventory rows are included regardless of range.

Clicking **Download Excel File** generates the workbook entirely in the browser (via the `xlsx`/SheetJS library) and triggers a normal file download — no server round-trip or extra Supabase calls required.

## What changed in the code

- `package.json` — added the `xlsx` dependency.
- `src/App.jsx`:
  - Imported `XLSX` from the `xlsx` package.
  - Added export-related state: `exportType`, `exportRange`, `exportMonth`, `exportDate`, `exportError`, `exportMsg`, `exporting`.
  - Added a `handleExport()` function that builds the workbook and calls `XLSX.writeFile(...)`.
  - Added an `"export"` entry to the `TABS` array.
  - Added the Export tab's UI panel (type selector, range selector, month/date pickers, download button).

No existing functionality, styling, or database schema was changed.

## Run it

```bash
npm install
npm run dev
```

Then open the app, sign in, and click the **Export** tab.

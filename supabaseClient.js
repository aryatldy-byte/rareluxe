import { createClient } from '@supabase/supabase-js';

// Credentials now come from environment variables (see .env / .env.example)
// instead of being hardcoded in source, so they are never committed to git
// and can differ safely between local dev, preview and production
// deployments on Vercel.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fails loudly during local dev / build instead of silently breaking auth,
  // since a missing .env is the most common cause of a blank/broken app.
  console.error(
    "Missing Supabase environment variables. Copy .env.example to .env and " +
    "fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

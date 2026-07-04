// Two Supabase clients: one for token verification (anon), one for DB (service role).
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const authOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Verifies user access tokens via supabase.auth.getUser(token)
const authClient = createClient(url, process.env.SUPABASE_ANON_KEY, authOpts);

// Server-side DB access; bypasses Row Level Security. NEVER expose to the browser.
const adminClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, authOpts);

module.exports = { authClient, adminClient };

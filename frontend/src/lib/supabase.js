import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Missing Supabase configuration. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY " +
      "as Environment Variables in your host (e.g. Vercel), then redeploy — CRA inlines these at build time."
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

// React StrictMode can run callback effects more than once in development.
// Reuse an in-flight exchange for the same authorization code so Supabase's
// one-time PKCE code is never submitted twice.
let pendingCode = null;
let pendingExchange = null;

export function exchangeCodeForSessionOnce(code) {
  if (!code) return Promise.reject(new Error("Missing authorization code."));
  if (pendingCode !== code || !pendingExchange) {
    pendingCode = code;
    pendingExchange = supabase.auth.exchangeCodeForSession(code).finally(() => {
      pendingCode = null;
      pendingExchange = null;
    });
  }
  return pendingExchange;
}

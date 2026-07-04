import axios from "axios";
import { supabase } from "@/lib/supabase";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({ baseURL: `${BACKEND_URL}/api` });

// Cache the Supabase access token from auth state changes (avoids calling
// supabase.auth.getSession() inside the request interceptor, which can deadlock
// the GoTrue lock during initial session restore).
let accessToken = null;
supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token || null;
});

// Synchronous fallback: read the persisted session straight from localStorage
// (covers the brief window on hard-reload before onAuthStateChange fires).
function tokenFromStorage() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-") && key.includes("-auth-token")) {
        const v = JSON.parse(window.localStorage.getItem(key));
        return v?.access_token || v?.currentSession?.access_token || null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

api.interceptors.request.use((config) => {
  const token = accessToken || tokenFromStorage();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;

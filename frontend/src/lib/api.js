import axios from "axios";
import { supabase } from "@/lib/supabase";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// In production, keep API traffic on the Vercel origin. frontend/vercel.json
// proxies /api/* to Render, so browsers in networks that reset direct
// onrender.com connections never need to contact that domain themselves.
// Local development continues to use REACT_APP_BACKEND_URL directly.
const API_BASE_URL = process.env.NODE_ENV === "production"
  ? "/api"
  : `${BACKEND_URL || "http://localhost:8001"}/api`;

const api = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

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

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase, exchangeCodeForSessionOnce } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const started = useRef(false);
  const [message, setMessage] = useState("Completing secure sign-in…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    const fail = (error) => {
      if (!active) return;
      const message = error?.message || "Authentication could not be completed.";
      navigate(`/login?error_description=${encodeURIComponent(message)}`, { replace: true });
    };

    const complete = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const oauthError = params.get("error_description") || params.get("error");
        if (oauthError) throw new Error(oauthError);

        const code = params.get("code");
        if (code) {
          // A page reload can revisit the one-time callback URL after the
          // exchange already succeeded. Reuse the persisted session instead
          // of attempting to consume the PKCE code/verifier again.
          const { data: existing, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!existing.session) {
            const { error } = await exchangeCodeForSessionOnce(code);
            if (error) throw error;
          }
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) throw new Error("The sign-in callback is missing or has expired.");
        }

        if (!active) return;
        setMessage("Loading your account…");

        // Render may be waking from an idle state. Retry profile hydration so
        // a valid Supabase login is not sent back to /login during a cold start.
        let profile = null;
        for (let attempt = 0; attempt < 3 && !profile; attempt += 1) {
          profile = await refreshUser();
          if (!profile && attempt < 2) await wait((attempt + 1) * 1000);
        }
        if (!profile) throw new Error("Signed in, but the account profile could not be loaded. Please try again.");

        if (active) navigate(profile.role === "admin" ? "/admin" : "/dashboard", { replace: true });
      } catch (error) {
        fail(error);
      }
    };

    complete();
    return () => { active = false; };
  }, [navigate, refreshUser]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 px-6" data-testid="auth-callback-loading">
      <img src="/pa-logo.png" alt="PA Copilot logo" className="w-14 h-14 object-contain" />
      <Loader2 className="mt-6 w-7 h-7 text-emerald-700 animate-spin" />
      <p className="mt-4 text-sm text-stone-500">{message}</p>
    </div>
  );
}

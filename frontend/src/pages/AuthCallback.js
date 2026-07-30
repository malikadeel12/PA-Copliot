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

    const failSignupRequired = () => {
      if (!active) return;
      // Supabase already created an auth.users row for this OAuth attempt.
      // Sign the user out immediately so they can't accidentally continue
      // with a half-created account, then bounce to /login with a friendly
      // message and pre-select the Register tab.
      try { sessionStorage.removeItem("pa-oauth-intent"); } catch { /* ignore */ }
      supabase.auth.signOut().finally(() => {
        if (!active) return;
        navigate("/login?error_description=" + encodeURIComponent("Please sign up first before signing in with Google.") + "&mode=register", { replace: true });
      });
    };

    const failAlreadyCreated = () => {
      if (!active) return;
      // User clicked "Sign up with Google" but a profile already exists for
      // this Google identity (or matching email). Send them to the Login tab
      // with a friendly hint.
      try { sessionStorage.removeItem("pa-oauth-intent"); } catch { /* ignore */ }
      supabase.auth.signOut().finally(() => {
        if (!active) return;
        navigate("/login?error_description=" + encodeURIComponent("An account already exists for this Google account. Please sign in instead.") + "&mode=login", { replace: true });
      });
    };

    const complete = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const oauthError = params.get("error_description") || params.get("error");
        if (oauthError) throw new Error(oauthError);

        // Three URL shapes can arrive here, depending on whether the user
        // got here from a Supabase email-confirmation link or a Google OAuth
        // PKCE redirect, and depending on which email template + Site URL
        // the Supabase project is configured with:
        //
        //   1. ?code=...                  — PKCE OAuth or PKCE email redirect
        //   2. ?token_hash=...&type=...   — custom email template using TokenHash
        //   3. #access_token=...&...      — implicit-flow hash (older configs)
        //
        // detectSessionInUrl=true on the client also covers the hash case,
        // but the others need an explicit exchange here.
        const code = params.get("code");
        const tokenHash = params.get("token_hash");
        const otpType = params.get("type");

        if (code) {
          // PKCE flow (OAuth or Supabase email redirect). Reuse the
          // persisted session if a previous visit already exchanged the
          // code — the PKCE verifier is single-use.
          const { data: existing, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!existing.session) {
            const { error } = await exchangeCodeForSessionOnce(code);
            if (error) throw error;
          }
        } else if (tokenHash && otpType) {
          // Custom email template sent a TokenHash link. Exchange it via
          // verifyOtp — this is the modern Supabase recommendation and the
          // missing piece that was making email-confirmation links silently
          // fail with "The sign-in callback is missing or has expired."
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
          if (error) throw error;
        } else {
          // No code, no token_hash — rely on detectSessionInUrl having
          // already populated the session from the URL hash (implicit flow).
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) throw new Error("The sign-in callback is missing or has expired.");
        }

        if (!active) return;
        setMessage("Loading your account…");

        // Render may be waking from an idle state. Retry profile hydration so
        // a valid Supabase login is not sent back to /login during a cold start.
        let profile = null;
        let signupRequired = false;
        let alreadyCreated = false;
        for (let attempt = 0; attempt < 3 && !profile; attempt += 1) {
          try {
            profile = await refreshUser();
          } catch (e) {
            // Backend returns SIGNUP_REQUIRED when a brand-new OAuth user
            // hits /auth/me with login intent and there's no pre-existing
            // profile row.
            if (e?.response?.data?.error_code === "SIGNUP_REQUIRED" || e?.code === "SIGNUP_REQUIRED") {
              signupRequired = true;
              break;
            }
            // Backend returns ALREADY_CREATED when a user with signup intent
            // hits /auth/me but a profile already exists for this Google
            // account / email.
            if (e?.response?.data?.error_code === "ALREADY_CREATED" || e?.code === "ALREADY_CREATED") {
              alreadyCreated = true;
              break;
            }
            throw e;
          }
          if (!profile && attempt < 2) await wait((attempt + 1) * 1000);
        }

        if (signupRequired) { failSignupRequired(); return; }
        if (alreadyCreated) { failAlreadyCreated(); return; }
        if (!profile) throw new Error("Signed in, but the account profile could not be loaded. Please try again.");

        // Stash cleared on success — the intent no longer needs to survive.
        try { sessionStorage.removeItem("pa-oauth-intent"); } catch { /* ignore */ }

        // If the user just confirmed their email, the profile was created
        // server-side but profile_complete is false (NPI / specialty / etc
        // are still empty). Force them through onboarding so the credits
        // granted on confirmation aren't stranded behind an empty profile.
        if (active) {
          if (!profile.profile_complete) navigate("/onboarding", { replace: true });
          else navigate("/dashboard", { replace: true });
        }
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

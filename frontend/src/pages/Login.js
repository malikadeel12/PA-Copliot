import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";
import { passwordRecoveryClient, supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrustBadge } from "@/components/TrustBadge";
import { toast } from "sonner";
import { ShieldCheck, Clock, FileCheck2, Loader2, Mail, RefreshCw } from "lucide-react";

const AUTH_BG = "/login-hero.png";

export default function Login() {
  const { user, loading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  // After sign-up we move to this mode so the user has a clear "check your
  // email + resend" UI. `pendingEmail` carries the email forward.
  const [awaitingEmail, setAwaitingEmail] = useState(null);

  useEffect(() => {
    if (user) {
      // Authenticated users without a complete prescriber profile are routed
      // to mandatory onboarding.
      if (!user.profile_complete) navigate("/onboarding", { replace: true });
      else navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  // Surface OAuth errors returned on the redirect (e.g. misconfigured Google
  // client, or "please sign up first" when a brand-new Google user attempts
  // to log in). Guard against React 18 StrictMode double-invocation clearing
  // the URL before the toast renders. Also honor `mode=register` so the
  // SIGNUP_REQUIRED path lands the user on the Register tab with their email
  // already filled in.
  const oauthErrShown = useRef(false);
  useEffect(() => {
    if (oauthErrShown.current) return;
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const err = q.get("error_description") || q.get("error") || h.get("error_description") || h.get("error");
    const requestedMode = q.get("mode");
    if (requestedMode === "register" || requestedMode === "login" || requestedMode === "forgot") {
      setMode(requestedMode);
    }
    if (err) {
      oauthErrShown.current = true;
      // Defer so the Toaster (a later sibling) has subscribed to sonner's store before we publish.
      const msg = decodeURIComponent(err).replace(/\+/g, " ");
      setTimeout(() => toast.error(msg, { duration: 8000 }), 100);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Avoid flashing the login form while the session is resolving or a redirect is pending.
  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50" data-testid="login-loading">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  const sendReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await passwordRecoveryClient.auth.resetPasswordForEmail(form.email, {
        redirectTo: window.location.origin + "/reset-password",
      });
      if (error) throw error;
      toast.success("If an account exists for that email, a reset link is on its way.");
      setMode("login");
    } catch (err) {
      toast.error(err?.message || "Could not send reset email. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Resend the verification email via the dedicated Supabase endpoint.
  // The user must already have an unconfirmed account (created via signUp);
  // this endpoint will simply no-op if the email is already confirmed or
  // rate-limited.
  const resendVerification = async () => {
    if (!awaitingEmail) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: awaitingEmail,
        options: {
          emailRedirectTo: window.location.origin + "/auth/callback",
        },
      });
      if (error) throw error;
      toast.success("Verification email resent. Check your inbox (and spam folder).", { duration: 8000 });
    } catch (err) {
      const msg = err?.message || "Couldn't resend the verification email.";
      toast.error(msg, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        const profile = await refreshUser();
        toast.success("Welcome back");
        if (!profile?.profile_complete) navigate("/onboarding", { replace: true });
        else navigate("/dashboard", { replace: true });
      } else {
      const { data, error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { full_name: form.name },
            emailRedirectTo: window.location.origin + "/auth/callback",
          },
        });
        if (error) throw error;
        if (data.session) {
          const profile = await refreshUser();
          toast.success("Account created — 10 free credits added");
          if (!profile?.profile_complete) navigate("/onboarding", { replace: true });
          else navigate("/dashboard", { replace: true });
        } else {
          // No session means email verification is required. Move into
          // the awaiting-verification UI so the user has a clear next step
          // and a "Resend verification email" button — Supabase's default
          // SMTP rate-limits and often lands in spam, so a resend is the
          // primary recovery path for "I never got the email" complaints.
          setAwaitingEmail(form.email);
        }
      }
    } catch (err) {
      toast.error(err?.message || formatApiError(err?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const googleLogin = async () => {
    // Stash the user's intent (signup vs login) so AuthCallback — which runs
    // after the cross-origin OAuth redirect — knows which case the user is in
    // and the backend can decide between "create new profile" and "load
    // existing profile". sessionStorage survives the round-trip through
    // accounts.google.com because it's bound to this origin.
    const intent = mode === "register" ? "signup" : "login";
    try { sessionStorage.setItem("pa-oauth-intent", intent); } catch { /* storage disabled — default to login */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
        // Force the account chooser + permissions consent screen on every
        // Google sign-in. Without this, Google silently re-authenticates the
        // last account when the browser session already has one.
        queryParams: { prompt: "select_account consent", access_type: "offline" },
      },
    });
    if (error) toast.error(error.message);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-stone-50">
      {/* Left — brand / trust */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <img src={AUTH_BG} alt="Calm clinic interior" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950/90 via-stone-900/75 to-stone-900/70" />
        <div className="absolute inset-0 pa-grid-bg opacity-[0.06]" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-lg shadow-black/10">
            <img src="/pa-logo.png" alt="PA Copilot logo" className="w-9 h-9 object-contain" />
          </div>
          <div className="text-white">
            <div className="font-heading font-bold text-xl tracking-tight">PA Copilot</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-200 font-semibold">Prior Authorization</div>
          </div>
        </div>

        <div className="relative z-10 text-white max-w-md">
          <h1 className="font-heading text-4xl xl:text-5xl font-semibold tracking-tight leading-[1.05]">
            A submission-ready prior auth in under 5 minutes.
          </h1>
          <p className="mt-5 text-stone-200 text-base leading-relaxed">
            Snap the documents, dictate the narrative, and let the AI draft your filled form, approval analysis, ranked fixes, and cover letter — without ever storing patient data.
          </p>
          <div className="mt-8 space-y-3">
            {[
              { icon: Clock, t: "Under 5 minutes per request" },
              { icon: FileCheck2, t: "4 deliverables, one click" },
              { icon: ShieldCheck, t: "Ephemeral — nothing persisted after export" },
            ].map(({ icon: Ic, t }) => (
              <div key={t} className="flex items-center gap-3 text-stone-100">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center"><Ic className="w-4 h-4" /></div>
                <span className="text-sm">{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10"><TrustBadge /></div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <img src="/pa-logo.png" alt="PA Copilot logo" className="w-11 h-11 object-contain" />
            <span className="font-heading font-bold text-xl text-stone-900">PA Copilot</span>
          </div>

          <h2 className="font-heading text-3xl font-semibold tracking-tight text-stone-900">
            {awaitingEmail
              ? "Check your email"
              : mode === "login"
              ? "Sign in"
              : mode === "register"
              ? "Create your account"
              : "Reset your password"}
          </h2>
          <p className="mt-2 text-stone-500 text-sm">
            {awaitingEmail
              ? "We sent a verification link to your inbox."
              : mode === "login"
              ? "Welcome back. Let's clear that queue."
              : mode === "register"
              ? "Start with 10 free analysis credits. Email verification required."
              : "Enter your email and we'll send you a reset link."}
          </p>

          {awaitingEmail ? (
            <>
              <div data-testid="awaiting-verification-panel" className="mt-6 rounded-lg bg-white border border-emerald-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 text-emerald-700">
                  <Mail className="w-5 h-5" />
                  <span className="font-heading font-semibold">Verification email sent</span>
                </div>
                <p className="mt-2 text-sm text-stone-600">
                  We sent a link to <span className="font-mono font-semibold text-stone-900">{awaitingEmail}</span>.
                  Open it to confirm your address and activate your 10 free credits.
                </p>
                <ul className="mt-4 space-y-1.5 text-xs text-stone-500 list-disc list-inside">
                  <li>The email can take up to a minute to arrive.</li>
                  <li>Check your spam / promotions folder if you don't see it.</li>
                  <li>If it never arrives, your project may be on Supabase's default SMTP which has tight rate limits — click Resend below.</li>
                </ul>
                <div className="mt-5 flex flex-col sm:flex-row gap-2">
                  <Button data-testid="resend-verification-btn" onClick={resendVerification} disabled={busy}
                    className="h-11 px-5 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950">
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Resend verification email
                  </Button>
                  <Button data-testid="back-to-login-from-awaiting" variant="outline" onClick={() => { setAwaitingEmail(null); setMode("login"); }}
                    className="h-11 px-5 border-stone-300">
                    Back to sign in
                  </Button>
                </div>
              </div>
            </>
          ) : mode === "forgot" ? (
            <>
              <form onSubmit={sendReset} className="mt-6 space-y-4">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Email</Label>
                  <Input data-testid="forgot-email-input" type="email" required value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@clinic.health" className="mt-1.5 h-11" />
                </div>
                <Button data-testid="forgot-submit-btn" type="submit" disabled={busy}
                  className="w-full h-11 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
                </Button>
              </form>
              <button data-testid="back-to-login-btn" onClick={() => setMode("login")}
                className="mt-5 text-sm font-semibold text-emerald-800 hover:text-emerald-700">
                ← Back to sign in
              </button>
            </>
          ) : (
          <>
          <div className="mt-6 grid grid-cols-2 p-1 bg-stone-100 rounded-xl">
            {["login", "register"].map((m) => (
              <button
                key={m}
                data-testid={`auth-tab-${m}`}
                onClick={() => setMode(m)}
                className={`py-2 text-sm font-semibold rounded-lg transition-all ${mode === m ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"}`}
              >
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Full name</Label>
                <Input data-testid="auth-name-input" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Dr. Jane Smith" className="mt-1.5 h-11" />
              </div>
            )}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Email</Label>
              <Input data-testid="auth-email-input" type="email" required value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@clinic.health" className="mt-1.5 h-11" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Password</Label>
                {mode === "login" && (
                  <button type="button" data-testid="forgot-password-link" onClick={() => setMode("forgot")}
                    className="text-xs font-semibold text-emerald-800 hover:text-emerald-700">
                    Forgot password?
                  </button>
                )}
              </div>
              <Input data-testid="auth-password-input" type="password" required value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••" className="mt-1.5 h-11" />
            </div>
            <Button data-testid="auth-submit-btn" type="submit" disabled={busy}
              className="w-full h-11 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === "login" ? "Sign In" : "Create Account")}
            </Button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-stone-200 flex-1" />
            <span className="text-xs text-stone-400 uppercase tracking-wider">or</span>
            <div className="h-px bg-stone-200 flex-1" />
          </div>

          <Button data-testid="google-login-btn" variant="outline" onClick={googleLogin}
            className="w-full h-11 border-stone-300 font-semibold rounded-lg hover:bg-stone-50">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-4 h-4 mr-2" />
            {mode === "register" ? "Sign up with Google" : "Sign in with Google"}
          </Button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

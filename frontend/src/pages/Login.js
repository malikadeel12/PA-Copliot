import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrustBadge } from "@/components/TrustBadge";
import { toast } from "sonner";
import { Activity, ShieldCheck, Clock, FileCheck2, Loader2 } from "lucide-react";

const AUTH_BG = "/login-hero.png";

export default function Login() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate(user.role === "admin" ? "/admin" : "/dashboard", { replace: true }); }, [user, navigate]);

  // Surface OAuth errors returned on the redirect (e.g. misconfigured Google client).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const err = q.get("error_description") || q.get("error") || h.get("error_description") || h.get("error");
    if (err) {
      toast.error(decodeURIComponent(err).replace(/\+/g, " "));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        const profile = await refreshUser();
        toast.success("Welcome back");
        navigate(profile?.role === "admin" ? "/admin" : "/dashboard", { replace: true });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.name } },
        });
        if (error) throw error;
        if (data.session) {
          const profile = await refreshUser();
          toast.success("Account created — 5 free credits added");
          navigate(profile?.role === "admin" ? "/admin" : "/dashboard", { replace: true });
        } else {
          toast.success("Account created. Please check your email to confirm, then sign in.");
          setMode("login");
        }
      }
    } catch (err) {
      toast.error(err?.message || formatApiError(err?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const googleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/login" },
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
            {mode === "login" ? "Sign in" : "Create your account"}
          </h2>
          <p className="mt-2 text-stone-500 text-sm">
            {mode === "login" ? "Welcome back. Let's clear that queue." : "Start with 5 free analysis credits."}
          </p>

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
              <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Password</Label>
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
            Continue with Google
          </Button>
        </div>
      </div>
    </div>
  );
}

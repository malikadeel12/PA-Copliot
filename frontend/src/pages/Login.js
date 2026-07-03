import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrustBadge } from "@/components/TrustBadge";
import { toast } from "sonner";
import { Activity, ShieldCheck, Clock, FileCheck2, Loader2 } from "lucide-react";

const AUTH_BG = "https://images.unsplash.com/photo-1631248055158-edec7a3c072b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNTl8MHwxfHNlYXJjaHwxfHxtZWRpY2FsJTIwY2xpbmljJTIwaW50ZXJpb3IlMjBjYWxtfGVufDB8fHx8MTc4MzExNDk0OXww&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate("/dashboard", { replace: true }); }, [user, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login"
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password };
      const { data } = await api.post(endpoint, payload);
      setUser(data.user);
      toast.success(mode === "login" ? "Welcome back" : "Account created — 5 free credits added");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const googleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-stone-50">
      {/* Left — brand / trust */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <img src={AUTH_BG} alt="Calm clinic interior" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-br from-stone-900/80 via-stone-900/60 to-emerald-900/70" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/95 flex items-center justify-center">
            <Activity className="w-6 h-6 text-emerald-600" strokeWidth={2.4} />
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
        <div className="relative z-10"><TrustBadge className="bg-white/10 border-white/20 text-emerald-100" /></div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" strokeWidth={2.4} />
            </div>
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
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg active:scale-[0.98] transition-all">
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

          <p className="mt-6 text-center text-xs text-stone-400 leading-relaxed">
            PA Copilot processes documents only during your session and purges everything on export.
            This is decision-support, not a payer guarantee.
          </p>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const errShown = useRef(false);

  useEffect(() => {
    // Surface an expired/invalid recovery link (arrives as an error in the URL hash).
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (h.get("error") && !errShown.current) {
      errShown.current = true;
      setInvalid(true);
      setTimeout(() => toast.error(decodeURIComponent(h.get("error_description") || h.get("error")).replace(/\+/g, " "), { duration: 8000 }), 100);
      return;
    }
    // detectSessionInUrl establishes the recovery session; wait for it.
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) return toast.error("Password must be at least 6 characters.");
    if (form.password !== form.confirm) return toast.error("Passwords do not match.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: form.password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Password updated. Please sign in with your new password.");
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(err?.message || "Could not update password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-6" data-testid="reset-password-page">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/pa-logo.png" alt="PA Copilot logo" className="w-11 h-11 object-contain" />
          <span className="font-heading font-bold text-xl text-stone-900">PA Copilot</span>
        </div>

        <h2 className="font-heading text-3xl font-semibold tracking-tight text-stone-900">Set a new password</h2>

        {invalid ? (
          <div className="mt-4">
            <p className="text-stone-500 text-sm">This reset link is invalid or has expired.</p>
            <Button data-testid="request-new-link-btn" onClick={() => navigate("/login")}
              className="mt-6 h-11 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md">
              Request a new link
            </Button>
          </div>
        ) : !ready ? (
          <div className="mt-8 flex items-center gap-2 text-stone-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Verifying your reset link…
          </div>
        ) : (
          <>
            <p className="mt-2 text-stone-500 text-sm">Choose a strong password you don't use elsewhere.</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">New password</Label>
                <Input data-testid="new-password-input" type="password" required value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••" className="mt-1.5 h-11" />
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Confirm password</Label>
                <Input data-testid="confirm-password-input" type="password" required value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  placeholder="••••••••" className="mt-1.5 h-11" />
              </div>
              <Button data-testid="update-password-btn" type="submit" disabled={busy}
                className="w-full h-11 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
              </Button>
            </form>
            <div className="mt-6 flex items-center gap-2 text-xs text-stone-400">
              <ShieldCheck className="w-4 h-4" /> You'll be asked to sign in again after updating.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
